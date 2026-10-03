/*!
 * nav-buttons.js — floating Back / Forward buttons for installed web apps (PWA).
 * Inject once per page: <script src="nav-buttons.js"></script> or paste inline before </body>.
 * Shows only in installed mode (standalone / fullscreen / minimal-ui). Set FORCE_SHOW = true to test in browser.
 */
(function () {
  'use strict';
  if (window.__navButtonsLoaded) return;
  window.__navButtonsLoaded = true;

  var FORCE_SHOW = false;          // true = show even in normal browser tab
  var POSITION   = 'bottom-left';  // 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right'
  var Z_INDEX    = 2147483000;

  var installed =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    window.navigator.standalone === true; // iOS
  if (!installed && !FORCE_SHOW) return;

  function build() {
    if (document.getElementById('nav-buttons-bar')) return;

    var style = document.createElement('style');
    style.textContent =
      '#nav-buttons-bar{position:fixed;display:flex;gap:6px;padding:6px;border-radius:999px;' +
      'background:rgba(20,20,30,.82);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);' +
      'box-shadow:0 4px 14px rgba(0,0,0,.3);z-index:' + Z_INDEX + ';user-select:none;-webkit-user-select:none;' +
      'transition:opacity .2s;touch-action:none}' +
      '#nav-buttons-bar button{all:unset;box-sizing:border-box;width:38px;height:38px;border-radius:50%;' +
      'display:flex;align-items:center;justify-content:center;color:#fff;cursor:pointer;' +
      '-webkit-tap-highlight-color:transparent}' +
      '#nav-buttons-bar button:active{background:rgba(255,255,255,.2)}' +
      '#nav-buttons-bar button[disabled]{opacity:.3;cursor:default;pointer-events:none}' +
      '#nav-buttons-bar svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.5;' +
      'stroke-linecap:round;stroke-linejoin:round}' +
      '@media print{#nav-buttons-bar{display:none!important}}';
    document.head.appendChild(style);

    var bar = document.createElement('div');
    bar.id = 'nav-buttons-bar';
    bar.setAttribute('role', 'navigation');
    bar.setAttribute('aria-label', 'Page navigation');

    var gap = '12px';
    var v = POSITION.indexOf('top') === 0 ? 'top' : 'bottom';
    var h = POSITION.indexOf('right') > -1 ? 'right' : 'left';
    bar.style[v] = 'calc(' + gap + ' + env(safe-area-inset-' + v + ', 0px))';
    bar.style[h] = 'calc(' + gap + ' + env(safe-area-inset-' + h + ', 0px))';

    var backBtn = mk('Back', '<svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>');
    var fwdBtn  = mk('Forward', '<svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>');

    function mk(label, svg) {
      var b = document.createElement('button');
      b.type = 'button';
      b.title = label;
      b.setAttribute('aria-label', label);
      b.innerHTML = svg;
      return b;
    }

    backBtn.addEventListener('click', function () { history.back(); });
    fwdBtn.addEventListener('click', function () { history.forward(); });

    bar.appendChild(backBtn);
    bar.appendChild(fwdBtn);
    document.body.appendChild(bar);

    // Enable/disable state. Navigation API (Chromium) knows exact state; fallback = best guess.
    var maxIdx = history.length - 1;
    function refresh() {
      var nav = window.navigation;
      if (nav && typeof nav.canGoBack === 'boolean') {
        backBtn.disabled = !nav.canGoBack;
        fwdBtn.disabled  = !nav.canGoForward;
      } else {
        // Fallback: history.length can't reveal position, so keep both enabled
        // except hide back when there's no history at all.
        backBtn.disabled = history.length <= 1;
        fwdBtn.disabled  = false;
      }
    }
    refresh();
    window.addEventListener('popstate', refresh);
    window.addEventListener('pageshow', refresh);
    window.addEventListener('hashchange', refresh);
    if (window.navigation && window.navigation.addEventListener) {
      window.navigation.addEventListener('currententrychange', refresh);
    }

    // Keyboard: Alt+Left / Alt+Right (desktop PWA)
    document.addEventListener('keydown', function (e) {
      if (!e.altKey) return;
      if (e.key === 'ArrowLeft')  { history.back(); }
      if (e.key === 'ArrowRight') { history.forward(); }
    });

    // Hide bar while an input is focused (keyboard open on mobile)
    document.addEventListener('focusin', function (e) {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) bar.style.opacity = '0', bar.style.pointerEvents = 'none';
    });
    document.addEventListener('focusout', function () {
      bar.style.opacity = '1'; bar.style.pointerEvents = '';
    });
  }

  if (document.body) build();
  else document.addEventListener('DOMContentLoaded', build);
})();