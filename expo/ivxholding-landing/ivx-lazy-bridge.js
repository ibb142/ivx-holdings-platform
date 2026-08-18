/**
 * IVX Lazy-Load Bridge (items 108-111 — extracted from inline <script>)
 * Provides on-demand loading of portal and investment modules.
 * Registration code is in ivx-app.js (loaded with defer).
 * Chat is loaded with defer (landing-support-chat.js).
 */
(function() {
  'use strict';

  function loadScript(src) {
    return new Promise(function(resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = function() { resolve(); };
      s.onerror = function() { reject(new Error('Failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }

  window._ivxLazyLoad = function(module) {
    if (module === 'portal') {
      if (window.IVXPortal) return Promise.resolve(window.IVXPortal);
      return loadScript('/ivx-portal.js?v=20260817-owner-portal-1').then(function() {\n        if (!window.IVXPortal) throw new Error('Portal module loaded without IVXPortal');\n        return window.IVXPortal;\n      });
    }
    if (module === 'invest') {
      if (window.IVXInvest) return Promise.resolve(window.IVXInvest);
      return loadScript('/ivx-invest.js').then(function() { return window.IVXInvest; });
    }
    return Promise.reject(new Error('Unknown module: ' + module));
  };

  // Portal — lazy loaded only when user opens portal (item 109)
  window.openPortal = function() {
    window._ivxLazyLoad('portal').then(function(m) { m.open(); })
      .catch(function(e) { console.error('[IVX] portal load failed', e); });
  };
  window.closePortal = function() {
    window._ivxLazyLoad('portal').then(function(m) { m.close(); })
      .catch(function(e) { console.error('[IVX] portal load failed', e); });
  };
  window.handlePortalLogin = function(e) {
    window._ivxLazyLoad('portal').then(function(m) { m.handleLogin(e); })
      .catch(function(e) { console.error('[IVX] portal load failed', e); });
  };
  window.portalLogout = function() {
    window._ivxLazyLoad('portal').then(function(m) { m.logout(); })
      .catch(function(e) { console.error('[IVX] portal load failed', e); });
  };

  // Investment — lazy loaded only when user opens invest flow (item 110)
  window.openInvestModal = function(dealId) {
    window._ivxLazyLoad('invest').then(function(m) { m.open(dealId); })
      .catch(function(e) { console.error('[IVX] invest load failed', e); });
  };
  window.closeInvestModal = function() {
    window._ivxLazyLoad('invest').then(function(m) { m.close(); })
      .catch(function(e) { console.error('[IVX] invest load failed', e); });
  };
  window.selectInvestPool = function(pool) {
    window._ivxLazyLoad('invest').then(function(m) { m.selectPool(pool); })
      .catch(function(e) { console.error('[IVX] invest load failed', e); });
  };
  window.setInvestAmount = function(amount) {
    window._ivxLazyLoad('invest').then(function(m) { m.setAmount(amount); })
      .catch(function(e) { console.error('[IVX] invest load failed', e); });
  };
  window.updateInvestSummary = function() {
    window._ivxLazyLoad('invest').then(function(m) { m.updateSummary(); })
      .catch(function(e) { console.error('[IVX] invest load failed', e); });
  };
  window.goInvestStep = function(step) {
    window._ivxLazyLoad('invest').then(function(m) { m.goStep(step); })
      .catch(function(e) { console.error('[IVX] invest load failed', e); });
  };
  window.switchInvestAuthTab = function(tab) {
    window._ivxLazyLoad('invest').then(function(m) { m.switchAuthTab(tab); })
      .catch(function(e) { console.error('[IVX] invest load failed', e); });
  };
  window.handleInvestAuth = function(e) {
    window._ivxLazyLoad('invest').then(function(m) { m.handleAuth(e); })
      .catch(function(e) { console.error('[IVX] invest load failed', e); });
  };
  window.selectPaymentMethod = function(method) {
    window._ivxLazyLoad('invest').then(function(m) { m.selectPayment(method); })
      .catch(function(e) { console.error('[IVX] invest load failed', e); });
  };
  window.toggleInvestTerms = function() {
    window._ivxLazyLoad('invest').then(function(m) { m.toggleTerms(); })
      .catch(function(e) { console.error('[IVX] invest load failed', e); });
  };
  window.submitInvestment = function() {
    window._ivxLazyLoad('invest').then(function(m) { m.submit(); })
      .catch(function(e) { console.error('[IVX] invest load failed', e); });
  };
})();
