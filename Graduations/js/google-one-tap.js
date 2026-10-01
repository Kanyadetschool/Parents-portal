/**
 * google-one-tap.js
 * Google Sign-In / One Tap helper. Also re-exports SessionManager +
 * guardPage (see session-manager.js) so both import from one file.
 *
 * import { GoogleOneTap, SessionManager } from './js/google-one-tap.js';
 * new GoogleOneTap({ clientId, onSuccess, onUnavailable }).init();
 * // No buttonContainer/div needed - runs silent-only by default.
 * // Pass buttonContainer (element or selector string) only if you also
 * // want the official rendered "Sign in with Google" button somewhere.
 * onSuccess(profile) -> { email, name, givenName, familyName, picture, sub, emailVerified }
 *
 * Doesn't touch Firebase - just resolves a Google profile and hands it
 * to onSuccess; what the page does with it is up to the page.
 */

export { SessionManager, guardPage } from './session-manager.js';


const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
const GIS_LOAD_TIMEOUT_MS = 6000;

/** Decodes a Google ID token (JWT) into its payload, client-side only.
 *  This is NOT signature verification - it's purely for reading the
 *  profile fields (email, name, picture) to prefill/display in the UI.
 *  Any security-sensitive check must still happen server-side / via
 *  Firebase Auth as normal. */
function decodeIdToken(idToken) {
  try {
    const payload = idToken.split('.')[1];
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(json);
  } catch (e) {
    console.error('[GoogleOneTap] Could not decode ID token:', e);
    return null;
  }
}

function toProfile(idToken, raw) {
  const payload = decodeIdToken(idToken);
  if (!payload) return null;
  return {
    email: (payload.email || '').trim(),
    emailVerified: !!payload.email_verified,
    name: payload.name || '',
    givenName: payload.given_name || '',
    familyName: payload.family_name || '',
    picture: payload.picture || '',
    sub: payload.sub || '',
    raw,
  };
}

/** Loads the Google Identity Services script once, even if several
 *  GoogleOneTap instances exist on the same page. Safe to call repeatedly. */
let gisLoadPromise = null;
function loadGis() {
  if (window.google && window.google.accounts && window.google.accounts.id) {
    return Promise.resolve();
  }
  if (gisLoadPromise) return gisLoadPromise;

  gisLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GIS_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('GIS script failed to load')));
      // In case it already loaded before we attached listeners:
      if (window.google && window.google.accounts && window.google.accounts.id) resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('GIS script failed to load'));
    document.head.appendChild(script);
  });

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('GIS script load timed out')), GIS_LOAD_TIMEOUT_MS)
  );

  return Promise.race([gisLoadPromise, timeout]);
}

export class GoogleOneTap {
  /**
   * @param {Object} opts
   * @param {string} opts.clientId - Google OAuth Client ID (required).
   * @param {HTMLElement|string} [opts.buttonContainer] - Element (or CSS/id
   *   selector string) to render the official "Sign in with Google" button
   *   into. Fully optional - omit it and GoogleOneTap runs silent-only via
   *   the zero-click One Tap prompt, no button/div needed on the page.
   * @param {Object} [opts.buttonOptions] - Overrides passed to
   *   google.accounts.id.renderButton (theme, size, shape, text, width...).
   * @param {boolean} [opts.autoSilentPrompt=true] - Also call the
   *   zero-click One Tap prompt in the background as soon as init() runs
   *   (or as soon as notifySignedOut() is called, if
   *   deferAutoPromptUntilSignal is set - see below). Defaults to true so
   *   pages work with no buttonContainer/div at all; pass false to opt out.
   * @param {boolean} [opts.deferAutoPromptUntilSignal=false] - Set this to
   *   true on any page that has its own session/auth check (Firebase or
   *   otherwise). Session restoration is normally async, so firing the
   *   silent prompt unconditionally on page load can flash it briefly even
   *   for an already-signed-in user. With this on, the library holds off
   *   the automatic prompt until the page calls notifySignedIn() or
   *   notifySignedOut() (see methods below) - so it only ever fires once
   *   the page has confirmed there's really no active session.
   * @param {boolean} [opts.autoSelect=false] - Google's auto_select option.
   * @param {boolean} [opts.useFedCM=true] - Google's use_fedcm_for_prompt option.
   * @param {(profile: object) => void} [opts.onSuccess] - Called with the
   *   decoded profile once a credential comes back (button click or silent).
   * @param {() => void} [opts.onUnavailable] - Called if GIS can't load at
   *   all (offline, blocked, ad-blocker, etc.) - show a manual fallback here.
   * @param {(err: Error) => void} [opts.onError] - Called on any other error.
   * @param {(reason: string) => void} [opts.onSuppressed] - Called when the
   *   silent One Tap prompt doesn't show because Google itself suppressed
   *   it (e.g. the user dismissed it before - reason "suppressed_by_user")
   *   or skipped it for another reason. This is normal, expected behavior
   *   from Google's anti-nag design and can't be forced open - use it to
   *   nudge the user toward the visible button instead.
   * @param {boolean} [opts.autoNudgeOnSuppressed=true] - When a silent
   *   prompt is suppressed/skipped and a buttonContainer was given, briefly
   *   highlight the button so the user notices the fallback sign-in option.
   * @param {boolean} [opts.debug=true] - console.log the internal steps.
   */
  constructor(opts = {}) {
    if (!opts.clientId) throw new Error('[GoogleOneTap] clientId is required');
    this.clientId = opts.clientId;
    // buttonContainer is fully optional. Accepts an Element, a CSS/id
    // selector string (resolved lazily in init(), since the element may
    // not exist in the DOM yet at construction time), or nothing at all.
    // With no container, GoogleOneTap runs in silent-only mode: no visible
    // "Sign in with Google" button is rendered, just the zero-click One
    // Tap bubble - so pages don't need to add a div for this to work.
    this._buttonContainerRef = opts.buttonContainer || null;
    this.buttonContainer = (opts.buttonContainer && typeof opts.buttonContainer !== 'string')
      ? opts.buttonContainer
      : null;
    this.buttonOptions = Object.assign(
      {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        shape: 'pill',
        text: 'continue_with',
        logo_alignment: 'left',
        width: 280,
      },
      opts.buttonOptions || {}
    );
    // Defaults to true (unlike before) so a page that only passes a
    // clientId + onSuccess still gets working sign-in via the silent
    // prompt, with no button/div required. Pass autoSilentPrompt:false
    // to opt out.
    this.autoSilentPrompt = opts.autoSilentPrompt !== false;
    this.deferAutoPromptUntilSignal = !!opts.deferAutoPromptUntilSignal;
    this._readyForAutoPrompt = false;   // init() has finished loading/initializing GIS
    this._autoPromptResolved = false;   // an auto-prompt decision (fire or skip) has already been made
    this._sessionSignal = null;         // null = unknown, true = signed in, false = confirmed signed out
    this.autoSelect = !!opts.autoSelect;
    this.useFedCM = opts.useFedCM !== false;
    this.onSuccess = typeof opts.onSuccess === 'function' ? opts.onSuccess : () => {};
    this.onUnavailable = typeof opts.onUnavailable === 'function' ? opts.onUnavailable : () => {};
    this.onError = typeof opts.onError === 'function' ? opts.onError : (err) => console.error(err);
    this.onSuppressed = typeof opts.onSuppressed === 'function' ? opts.onSuppressed : () => {};
    this.autoNudgeOnSuppressed = opts.autoNudgeOnSuppressed !== false;
    this.debug = opts.debug !== false;

    this._buttonRendered = false;
    this._initialized = false;
  }

  _log(...args) {
    if (this.debug) console.log('[GoogleOneTap]', ...args);
  }

  async _handleCredentialResponse(response) {
    this._log('Credential received', response);
    const profile = toProfile(response.credential, response);
    if (!profile || !profile.email) {
      this._log('Could not decode a usable profile/email from the credential');
      this.onError(new Error('Could not decode Google credential'));
      return;
    }
    this._log('Decoded profile', profile);
    this.onSuccess(profile);
  }

  /** Loads GIS (if needed), initializes it, and renders the button
   *  (if buttonContainer was given). Safe to call more than once. */
  async init() {
    try {
      await loadGis();
    } catch (err) {
      this._log('GIS unavailable:', err.message);
      this.onUnavailable();
      return;
    }

    if (!this._initialized) {
      this._log('Initializing with client ID', this.clientId);
      window.google.accounts.id.initialize({
        client_id: this.clientId,
        auto_select: this.autoSelect,
        use_fedcm_for_prompt: this.useFedCM,
        callback: (response) => this._handleCredentialResponse(response),
      });
      this._initialized = true;
    }

    if (this.buttonContainer === null && typeof this._buttonContainerRef === 'string') {
      // Resolve now (not at construction time) - the element may not have
      // existed in the DOM yet when `new GoogleOneTap()` ran. Accepts a
      // full selector ('#id', '.class') or a bare id string.
      const selector = this._buttonContainerRef;
      this.buttonContainer = document.querySelector(selector)
        || document.getElementById(selector.replace(/^#/, ''));
      if (!this.buttonContainer) {
        this._log(`buttonContainer "${selector}" not found in the DOM - continuing without a visible button (silent prompt only).`);
      }
    }

    if (this.buttonContainer && !this._buttonRendered) {
      this._log('Rendering button into container');
      window.google.accounts.id.renderButton(this.buttonContainer, this.buttonOptions);
      this._buttonRendered = true;
    }

    if (this.autoSilentPrompt) {
      this._readyForAutoPrompt = true;
      this._maybeAutoPrompt();
    }
  }

  /** Internal: fires (or skips) the automatic silent prompt exactly once,
   *  once both init() has finished AND - if deferAutoPromptUntilSignal is
   *  set - the page has reported its session state via notifySignedIn()/
   *  notifySignedOut(). Safe to call multiple times; only ever acts once. */
  _maybeAutoPrompt() {
    if (!this._readyForAutoPrompt || this._autoPromptResolved) return;
    if (this.deferAutoPromptUntilSignal && this._sessionSignal === null) {
      this._log('Auto silent prompt deferred - waiting for notifySignedIn()/notifySignedOut()');
      return;
    }
    this._autoPromptResolved = true;
    if (this._sessionSignal === true) {
      this._log('Session already active - skipping auto silent prompt');
      return;
    }
    this.promptSilent();
  }

  /** Call this from your page's own auth-state listener as soon as it
   *  confirms a session IS active (e.g. Firebase onAuthStateChanged with a
   *  non-null user). Cancels any in-flight/pending silent prompt and
   *  prevents the automatic one from firing this page load. Safe to call
   *  more than once (e.g. on every onAuthStateChanged tick). */
  notifySignedIn() {
    this._sessionSignal = true;
    if (!this._autoPromptResolved) this._autoPromptResolved = true;
    this.cancel();
  }

  /** Call this from your page's own auth-state listener as soon as it
   *  confirms there is NO active session. If deferAutoPromptUntilSignal
   *  was set, this is what actually releases the automatic silent prompt.
   *  Safe to call more than once - only the first call after a signed-in
   *  state (or at all) triggers the prompt. */
  notifySignedOut() {
    this._sessionSignal = false;
    this._maybeAutoPrompt();
  }

  /** Triggers the zero-click One Tap prompt. Resolves/rejects nothing -
   *  outcomes are reported via the notification callback (logged) and,
   *  on success, via onSuccess like the button. Also runs suppression
   *  detection internally (see _handleSilentNotification) regardless of
   *  whether an onNotification callback is supplied. */
  promptSilent(onNotification) {
    if (!window.google || !window.google.accounts || !window.google.accounts.id) {
      this._log('promptSilent() called before GIS was ready - ignoring');
      return;
    }
    this._log('Prompting (silent One Tap)...');
    window.google.accounts.id.prompt((notification) => {
      this._log('Silent prompt notification:', notification);
      this._handleSilentNotification(notification);
      if (typeof onNotification === 'function') onNotification(notification);
    });
  }

  /** Inspects a prompt notification for "not displayed" / "skipped"
   *  moments (e.g. reason "suppressed_by_user" after a prior dismissal)
   *  and, if found, fires onSuppressed + nudges the visible button.
   *  The inspection methods (isNotDisplayed/getNotDisplayedReason/
   *  isSkippedMoment/getSkippedReason) are wrapped in try/catch since
   *  Google is deprecating them as part of the FedCM migration and they
   *  may not exist on every notification shape going forward. */
  _handleSilentNotification(notification) {
    if (!notification) return;
    let inactive = false;
    let reason = 'unknown';
    try {
      if (typeof notification.isNotDisplayed === 'function' && notification.isNotDisplayed()) {
        inactive = true;
        reason = (typeof notification.getNotDisplayedReason === 'function' && notification.getNotDisplayedReason()) || reason;
      }
    } catch (e) { /* ignore - deprecated method may throw/be absent */ }
    try {
      if (!inactive && typeof notification.isSkippedMoment === 'function' && notification.isSkippedMoment()) {
        inactive = true;
        reason = (typeof notification.getSkippedReason === 'function' && notification.getSkippedReason()) || reason;
      }
    } catch (e) { /* ignore - deprecated method may throw/be absent */ }

    if (!inactive) return;
    this._log('Silent prompt did not show, reason:', reason);
    if (this.autoNudgeOnSuppressed) this._nudgeButton();
    this.onSuppressed(reason);
  }

  /** Briefly highlights the rendered "Sign in with Google" button so a
   *  user whose silent prompt got suppressed still notices there's a
   *  way to sign in. No-op if no buttonContainer was given/rendered. */
  _nudgeButton() {
    if (!this.buttonContainer) return;
    const el = this.buttonContainer;
    const prevTransition = el.style.transition;
    const prevShadow = el.style.boxShadow;
    const prevTransform = el.style.transform;
    el.style.transition = 'box-shadow .3s ease, transform .3s ease';
    el.style.boxShadow = '0 0 0 4px rgba(41,128,185,.35)';
    el.style.transform = 'scale(1.03)';
    setTimeout(() => {
      el.style.boxShadow = prevShadow;
      el.style.transform = prevTransform;
      setTimeout(() => { el.style.transition = prevTransition; }, 300);
    }, 650);
  }

  /** Cancels any in-flight One Tap prompt. Call this when closing a modal
   *  or navigating away so a stray prompt doesn't linger. */
  cancel() {
    if (window.google && window.google.accounts && window.google.accounts.id) {
      window.google.accounts.id.cancel();
    }
  }

  /** Fully signs the user out of Google One Tap's auto-select for this
   *  site (so it won't auto-pick the same account next time). */
  disableAutoSelect() {
    if (window.google && window.google.accounts && window.google.accounts.id) {
      window.google.accounts.id.disableAutoSelect();
    }
  }
}

// Also expose on window for pages that aren't using ES module imports.
if (typeof window !== 'undefined') {
  window.GoogleOneTap = GoogleOneTap;
}