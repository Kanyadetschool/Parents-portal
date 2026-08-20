/**
 * session-manager.js
 * Hard 15-minute session limit, persisted in localStorage so it survives
 * tab close/reopen and syncs across tabs. Only .start() resets the clock.
 *
 * Login page (index.html, where the auth-gate lives):
 *   import { SessionManager } from './js/session-manager.js';
 *   const session = new SessionManager({ onExpire: () => location.href = 'index.html?reason=session-expired' });
 *   session.start(); // after a successful login
 *
 * Every other protected page:
 *   import { guardPage } from 'https://kanyadet-school-admin.web.app/js/session-manager.js';
 *   const session = guardPage(); // resumes countdown, or redirects to login if expired/none
 *   // A <button id="logoutBtn"> on the page is auto-wired to session.expireNow();
 *   // call session.expireNow() yourself only if using a different element/id.
 */

const DEFAULT_STORAGE_KEY = 'kanyadet_session_expiry';
const DEFAULT_SESSION_DURATION_MS = 15 * 60 * 1000; // 15 minutes, compulsory

export class SessionManager {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.durationMs=900000] - Total session length in ms
   *   (default 15 minutes). This is an ABSOLUTE limit from login time -
   *   it is not extended by activity/clicks, per the "compulsory reset"
   *   requirement.
   * @param {string} [opts.storageKey] - localStorage key used to persist
   *   the expiry timestamp. Use the SAME key on every page that should
   *   share one session.
   * @param {() => void} [opts.onExpire] - Called once when the session
   *   ends, whether that's a natural timeout, expiry discovered on
   *   resume(), or a manual expireNow() call.
   * @param {(remainingMs: number) => void} [opts.onTick] - Called about
   *   once a second with the time left, for showing a countdown badge.
   * @param {number} [opts.checkIntervalMs=1000] - How often to check/tick.
   * @param {boolean} [opts.debug=true] - console.log internal steps.
   */
  constructor(opts = {}) {
    this.durationMs = opts.durationMs || DEFAULT_SESSION_DURATION_MS;
    this.storageKey = opts.storageKey || DEFAULT_STORAGE_KEY;
    this.onExpire = typeof opts.onExpire === 'function' ? opts.onExpire : () => {};
    this.onTick = typeof opts.onTick === 'function' ? opts.onTick : null;
    this.checkIntervalMs = opts.checkIntervalMs || 1000;
    this.debug = opts.debug !== false;

    this._timer = null;
    this._expired = false;

    // Cross-tab sync: if another tab clears/changes the expiry (logout,
    // natural expiry, or a fresh login), react here too instead of this
    // tab silently outliving the session.
    this._onStorage = (e) => {
      if (e.key !== this.storageKey) return;
      this._log('Storage event from another tab:', e.newValue);
      if (!e.newValue) {
        // Another tab cleared the session (logout or expiry).
        this._handleExpire();
      } else {
        // Another tab started/renewed a session - pick up the new expiry.
        this._beginTicking();
      }
    };
    window.addEventListener('storage', this._onStorage);
  }

  _log(...args) {
    if (this.debug) console.log('[SessionManager]', ...args);
  }

  _getExpiry() {
    const raw = localStorage.getItem(this.storageKey);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  /** Milliseconds left in the current session, 0 if none/expired. */
  remainingMs() {
    const expiry = this._getExpiry();
    if (!expiry) return 0;
    return Math.max(0, expiry - Date.now());
  }

  /** True if a non-expired session is currently stored. */
  isActive() {
    return this.remainingMs() > 0;
  }

  /** Starts a BRAND NEW session (call this right after a successful
   *  login). Overwrites any previous expiry with "now + durationMs". */
  start() {
    this._expired = false;
    const expiry = Date.now() + this.durationMs;
    localStorage.setItem(this.storageKey, String(expiry));
    this._log('Session started, expires at', new Date(expiry).toLocaleTimeString());
    this._beginTicking();
  }

  /** Call on every page load of an already-authenticated page. Resumes
   *  the EXISTING countdown (does not reset it) - so leaving and coming
   *  back later, even in a new tab, continues from where it stopped.
   *  Returns true if a valid session was resumed, false if there was no
   *  session or it had already expired (onExpire fires automatically in
   *  the expired case). */
  resume() {
    const expiry = this._getExpiry();
    if (!expiry) {
      this._log('No stored session found - nothing to resume');
      return false;
    }
    if (Date.now() >= expiry) {
      this._log('Stored session already expired while tab was away');
      this._handleExpire();
      return false;
    }
    this._log('Resuming session, expires at', new Date(expiry).toLocaleTimeString());
    this._beginTicking();
    return true;
  }

  _beginTicking() {
    this._stopTicking();
    this._expired = false;
    this._check(); // immediate check/tick
    this._timer = setInterval(() => this._check(), this.checkIntervalMs);
  }

  _stopTicking() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  _check() {
    const remaining = this.remainingMs();
    if (this.onTick) this.onTick(remaining);
    if (remaining <= 0) {
      this._handleExpire();
    }
  }

  _handleExpire() {
    if (this._expired) return; // only fire once
    this._expired = true;
    this._stopTicking();
    localStorage.removeItem(this.storageKey);
    this._log('Session expired/cleared');
    this.onExpire();
  }

  /** Ends the session immediately (natural expiry OR manual logout) and
   *  fires onExpire. Also clears it in every other open tab. */
  expireNow() {
    this._handleExpire();
  }

  /** Stops the local countdown timer WITHOUT clearing the stored
   *  session - e.g. the page is navigating to another page on the same
   *  site where resume() will pick it back up. Usually you don't need
   *  to call this manually; navigating away naturally tears down the
   *  interval with the page. */
  pauseTicking() {
    this._stopTicking();
  }

  /** Removes the storage listener - call if you ever need to fully
   *  discard this instance without a page unload doing it for you. */
  destroy() {
    this._stopTicking();
    window.removeEventListener('storage', this._onStorage);
  }
}

/**
 * One-line guard for a protected page. Resumes the existing session and,
 * if there isn't a valid one (never logged in, or the 15 minutes ran out
 * while the tab was away), immediately redirects to loginUrl - so most
 * pages only need this single call instead of the full resume()/if
 * dance shown in the class doc above.
 *
 *   import { guardPage } from './js/session-manager.js';
 *   const session = guardPage({ onTick: (ms) => updateBadge(ms) });
 *
 * Options are the same as SessionManager's constructor, plus:
 * @param {string} [opts.loginUrl='index.html?reason=session-expired']
 * @returns {SessionManager} the underlying instance, in case the page
 *   also wants to call session.expireNow() on a logout button.
 */
export function guardPage(opts = {}) {
  const { loginUrl = 'index.html?reason=session-expired', onExpire, ...rest } = opts;

  const session = new SessionManager({
    ...rest,
    onExpire: () => {
      if (typeof onExpire === 'function') onExpire();
      window.location.href = loginUrl;
    },
  });

  if (!session.resume()) {
    // resume() already fired onExpire (and thus redirected) if a session
    // existed but had timed out. This extra redirect only covers the
    // "never logged in at all" case, where onExpire never fires.
    if (!session._expired) {
      window.location.href = loginUrl;
    }
  }

  // Auto-wire a manual logout button if the page has one, so pages
  // don't each need their own click listener wired to
  // session.expireNow(). Different pages use different ids for this
  // button, so match on both id and class variants seen across the
  // site. Safe no-op if no matching button is on the page.
  const logoutBtn = document.getElementById('logoutBtn')
    || document.getElementById('logout-btn')
    || document.querySelector('.logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => session.expireNow());
  }

  return session;
}