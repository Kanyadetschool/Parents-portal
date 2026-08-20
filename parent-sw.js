/* ══════════════════════════════════════════════════════════════
   Kanyadet Parent Portal — background-check service worker
   Mirrors the free Periodic Background Sync approach used by the
   Teacher Portal: no Cloud Functions, no FCM push server, no Blaze
   billing plan. The browser itself wakes this worker on its own
   schedule (Chrome/Edge, installed PWA only) and it does one plain
   REST read against the Realtime Database using a Firebase ID token
   the page handed it earlier via postMessage.
══════════════════════════════════════════════════════════════ */

const DB_BASE = 'https://kanyadet-school-admin-default-rtdb.firebaseio.com';
const IDB_NAME = 'parent-portal-bgsync';
const IDB_STORE = 'kv';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

/* ── tiny IndexedDB key/value helper (auth token + last-seen markers survive SW restarts) ── */
function idbOpen(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key){
  const db = await idbOpen();
  return new Promise((resolve) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });
}
async function idbSet(key, value){
  const db = await idbOpen();
  return new Promise((resolve) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/* ── page hands us a fresh ID token whenever auth state changes ── */
self.addEventListener('message', (e) => {
  if(e.data && e.data.type === 'PARENT_AUTH'){
    e.waitUntil?.(idbSet('auth', { token: e.data.token, uid: e.data.uid, savedAt: Date.now() }));
    if(!e.waitUntil) idbSet('auth', { token: e.data.token, uid: e.data.uid, savedAt: Date.now() });
  }
});

/* ── the actual free "check" — one REST read, compared to what we saw last time ── */
async function checkForUpdates(){
  const auth = await idbGet('auth');
  if(!auth || !auth.token || !auth.uid) return; // never signed in on this device yet

  let newestReplyAt = 0;
  let newAdmissionUpdate = false;

  try{
    const res = await fetch(`${DB_BASE}/activities.json?auth=${auth.token}`);
    if(res.ok){
      const data = await res.json() || {};
      for(const item of Object.values(data)){
        if(!item || item.userId !== auth.uid) continue;
        if(item.type !== 'parent_inquiry' && item.type !== 'parent_teacher_message') continue;
        if(!item.replies) continue;
        for(const r of Object.values(item.replies)){
          if(r && (r.from === 'admin' || r.from === 'teacher') && r.timestamp > newestReplyAt){
            newestReplyAt = r.timestamp;
          }
        }
      }
    }
  }catch(e){ /* offline or blocked — just skip this cycle, try again next time */ }

  try{
    const res = await fetch(`${DB_BASE}/admissionRequests.json?auth=${auth.token}`);
    if(res.ok){
      const data = await res.json() || {};
      const lastSeenAdmission = (await idbGet('lastSeenAdmissionUpdatedAt')) || 0;
      for(const item of Object.values(data)){
        if(!item || item.userId !== auth.uid) continue;
        if(item.status && item.status !== 'pending' && (item.statusUpdatedAt || item.timestamp || 0) > lastSeenAdmission){
          newAdmissionUpdate = true;
        }
      }
    }
  }catch(e){ /* skip */ }

  const lastSeenReply = (await idbGet('lastSeenReplyAt')) || 0;
  const notifications = [];
  if(newestReplyAt > lastSeenReply){
    notifications.push({ title: 'New reply from the school', body: 'You have a new reply to one of your messages.' });
    await idbSet('lastSeenReplyAt', newestReplyAt);
  }
  if(newAdmissionUpdate){
    notifications.push({ title: 'Admission request updated', body: 'One of your admission requests has a status update.' });
    await idbSet('lastSeenAdmissionUpdatedAt', Date.now());
  }

  for(const n of notifications){
    try{
      await self.registration.showNotification(n.title, {
        body: n.body,
        icon: './images/logo.png',
        badge: './images/logo.png',
        tag: 'kanyadet-parent-update'
      });
    }catch(e){ /* notifications permission may be off — nothing more we can do */ }
  }
}

self.addEventListener('periodicsync', (event) => {
  if(event.tag === 'parent-check-updates'){
    event.waitUntil(checkForUpdates());
  }
});

/* Lets a signed-in tab trigger an immediate check for testing, without
   waiting for the browser's own periodic schedule. */
self.addEventListener('message', (e) => {
  if(e.data && e.data.type === 'PARENT_CHECK_NOW'){
    e.waitUntil?.(checkForUpdates());
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      for(const c of clients){ if('focus' in c) return c.focus(); }
      if(self.clients.openWindow) return self.clients.openWindow('./index.html');
    })
  );
});
