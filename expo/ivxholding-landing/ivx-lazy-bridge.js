/**
 * IVX Lazy-Load Bridge (items 108-111 — extracted from inline <script>)
 * Provides on-demand loading of portal and investment modules.
 */
(function() {
  'use strict';
  var lastForgotToggleAt = 0;

  function loadScript(src) {
    return new Promise(function(resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = function() { resolve(); };
      s.onerror = function() { reject(new Error('Failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }

  window._ivxLazyLoad = function(module) {
    if (module === 'portal') {
      if (window.IVXPortal) return Promise.resolve(window.IVXPortal);
      return loadScript('/ivx-portal.js?v20260821-fp3').then(function() { return window.IVXPortal; });
    }
    if (module === 'invest') {
      if (window.IVXInvest) return Promise.resolve(window.IVXInvest);
      return loadScript('/ivx-invest.js').then(function() { return window.IVXInvest; });
    }
    return Promise.reject(new Error('Unknown module: ' + module));
  };

  function toggleForgotDom() {
    var forgotView = document.getElementById('portal-forgot-view');
    if (!forgotView) return false;
    var loginForm = document.getElementById('portal-login-form');
    var forgotLine = document.getElementById('portal-forgot-link-line');
    var signupLine = document.getElementById('portal-signup-line');
    var showingForgot = window.getComputedStyle(forgotView).display === 'none';
    forgotView.style.display = showingForgot ? 'block' : 'none';
    if (loginForm) loginForm.style.display = showingForgot ? 'none' : 'block';
    if (forgotLine) forgotLine.style.display = showingForgot ? 'none' : 'block';
    if (signupLine) signupLine.style.display = showingForgot ? 'none' : 'block';
    if (showingForgot) {
      var loginEmail = document.getElementById('portal-email');
      var forgotEmail = document.getElementById('portal-forgot-email');
      if (forgotEmail && loginEmail && loginEmail.value) forgotEmail.value = loginEmail.value;
      var errEl = document.getElementById('portal-forgot-error');
      var okEl = document.getElementById('portal-forgot-success');
      if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
      if (okEl) okEl.style.display = 'none';
    }
    return true;
  }

  window.openPortal = function() { window._ivxLazyLoad('portal').then(function(m) { m.open(); }).catch(function(e) { console.error('[IVX] portal load failed', e); }); };
  window.closePortal = function() { window._ivxLazyLoad('portal').then(function(m) { m.close(); }).catch(function(e) { console.error('[IVX] portal load failed', e); }); };
  window.handlePortalLogin = function(e) { window._ivxLazyLoad('portal').then(function(m) { m.handleLogin(e); }).catch(function(e) { console.error('[IVX] portal load failed', e); }); };
  window.portalLogout = function() { window._ivxLazyLoad('portal').then(function(m) { m.logout(); }).catch(function(e) { console.error('[IVX] portal load failed', e); }); };
  window.toggleForgotPassword = function() {
    lastForgotToggleAt = Date.now();
    if (toggleForgotDom()) return;
    window._ivxLazyLoad('portal').then(function(m) { m.toggleForgot(); }).catch(function(e) { console.error('[IVX] portal load failed', e); });
  };
  window.handleForgotPasswordSubmit = function(e) {
    if (e && e.preventDefault) e.preventDefault();
    window._ivxLazyLoad('portal').then(function(m) { m.forgotSubmit(e || { preventDefault: function() {} }); }).catch(function(err) { console.error('[IVX] portal load failed', err); });
  };

  document.addEventListener('click', function(e) {
    var target = e.target;
    if (!target || !target.closest) return;
    var forgotLink = target.closest('#portal-forgot-link-line a');
    var backLink = target.closest('#portal-forgot-view a');
    if (forgotLink || backLink) {
      e.preventDefault();
      if (Date.now() - lastForgotToggleAt > 100) {
        lastForgotToggleAt = Date.now();
        toggleForgotDom();
      }
    }
  });
  document.addEventListener('submit', function(e) {
    var form = e.target;
    if (form && form.id === 'portal-forgot-form') { e.preventDefault(); window.handleForgotPasswordSubmit(e); }
  });

  window.openInvestModal = function(dealId) { window._ivxLazyLoad('invest').then(function(m) { m.open(dealId); }).catch(function(e) { console.error('[IVX] invest load failed', e); }); };
  window.closeInvestModal = function() { window._ivxLazyLoad('invest').then(function(m) { m.close(); }).catch(function(e) { console.error('[IVX] invest load failed', e); }); };
  window.selectInvestPool = function(pool) { window._ivxLazyLoad('invest').then(function(m) { m.selectPool(pool); }).catch(function(e) { console.error('[IVX] invest load failed', e); }); };
  window.setInvestAmount = function(amount) { window._ivxLazyLoad('invest').then(function(m) { m.setAmount(amount); }).catch(function(e) { console.error('[IVX] invest load failed', e); }); };
  window.updateInvestSummary = function() { window._ivxLazyLoad('invest').then(function(m) { m.updateSummary(); }).catch(function(e) { console.error('[IVX] invest load failed', e); }); };
  window.goInvestStep = function(step) { window._ivxLazyLoad('invest').then(function(m) { m.goStep(step); }).catch(function(e) { console.error('[IVX] invest load failed', e); }); };
  window.switchInvestAuthTab = function(tab) { window._ivxLazyLoad('invest').then(function(m) { m.switchAuthTab(tab); }).catch(function(e) { console.error('[IVX] invest load failed', e); }); };
  window.handleInvestAuth = function(e) { window._ivxLazyLoad('invest').then(function(m) { m.handleAuth(e); }).catch(function(e) { console.error('[IVX] invest load failed', e); }); };
  window.selectPaymentMethod = function(method) { window._ivxLazyLoad('invest').then(function(m) { m.selectPayment(method); }).catch(function(e) { console.error('[IVX] invest load failed', e); }); };
  window.toggleInvestTerms = function() { window._ivxLazyLoad('invest').then(function(m) { m.toggleTerms(); }).catch(function(e) { console.error('[IVX] invest load failed', e); }); };
  window.submitInvestment = function() { window._ivxLazyLoad('invest').then(function(m) { m.submit(); }).catch(function(e) { console.error('[IVX] invest load failed', e); }); };
})();