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

  function ensureInvestForgotPasswordLink() {
    var form = document.getElementById('invest-auth-form');
    var loginTab = document.getElementById('invest-tab-login');
    if (!form || !loginTab) return;

    var existing = document.getElementById('invest-forgot-password-link');
    if (!existing) {
      var link = document.createElement('a');
      link.id = 'invest-forgot-password-link';
      link.href = '/forgot-password.html';
      link.textContent = 'Forgot password?';
      link.setAttribute('aria-label', 'Reset your IVX password');
      link.style.display = 'none';
      link.style.marginTop = '10px';
      link.style.marginBottom = '2px';
      link.style.textAlign = 'right';
      link.style.color = '#FFD700';
      link.style.fontSize = '13px';
      link.style.fontWeight = '700';
      link.style.textDecoration = 'none';
      link.addEventListener('click', function(event) {
        event.preventDefault();
        var emailInput = document.getElementById('invest-email');
        var email = emailInput && emailInput.value ? String(emailInput.value).trim() : '';
        window.location.href = '/forgot-password.html' + (email ? '?email=' + encodeURIComponent(email) : '');
      });
      form.appendChild(link);
      existing = link;
    }

    existing.style.display = loginTab.classList.contains('active') ? 'block' : 'none';
  }

  function bindInvestRecovery() {
    ensureInvestForgotPasswordLink();
    var loginTab = document.getElementById('invest-tab-login');
    var signupTab = document.getElementById('invest-tab-signup');
    [loginTab, signupTab].forEach(function(tab) {
      if (!tab || tab.dataset.ivxForgotBound === 'true') return;
      tab.dataset.ivxForgotBound = 'true';
      tab.addEventListener('click', function() {
        setTimeout(ensureInvestForgotPasswordLink, 0);
      });
    });
  }

  window._ivxLazyLoad = function(module) {
    if (module === 'portal') {
      if (window.IVXPortal) return Promise.resolve(window.IVXPortal);
      return loadScript('/ivx-portal.js?v=20260817-owner-portal-1').then(function() {
        if (!window.IVXPortal) throw new Error('Portal module loaded without IVXPortal');
        return window.IVXPortal;
      });
    }
    if (module === 'invest') {
      if (window.IVXInvest) {
        setTimeout(bindInvestRecovery, 0);
        return Promise.resolve(window.IVXInvest);
      }
      return loadScript('/ivx-invest.js').then(function() {
        setTimeout(bindInvestRecovery, 0);
        return window.IVXInvest;
      });
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

  // The landing page CSP intentionally blocks inline event handlers. Bind the
  // existing portal links from this trusted external script so their legacy
  // onclick attributes cannot silently fall through to href="#".
  function bindPortalLinks() {
    document.querySelectorAll('[onclick*="openPortal"]').forEach(function(link) {
      if (link.dataset.ivxPortalBound === 'true') return;
      link.dataset.ivxPortalBound = 'true';
      link.addEventListener('click', function(event) {
        event.preventDefault();
        window.openPortal();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      bindPortalLinks();
      bindInvestRecovery();
    }, { once: true });
  } else {
    bindPortalLinks();
    bindInvestRecovery();
  }

  // Investment — lazy loaded only when user opens invest flow (item 110)
  window.openInvestModal = function(dealId) {
    window._ivxLazyLoad('invest').then(function(m) {
      m.open(dealId);
      setTimeout(bindInvestRecovery, 0);
    }).catch(function(e) { console.error('[IVX] invest load failed', e); });
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
    window._ivxLazyLoad('invest').then(function(m) {
      m.goStep(step);
      if (step === 3) setTimeout(bindInvestRecovery, 0);
    }).catch(function(e) { console.error('[IVX] invest load failed', e); });
  };
  window.switchInvestAuthTab = function(tab) {
    window._ivxLazyLoad('invest').then(function(m) {
      m.switchAuthTab(tab);
      setTimeout(bindInvestRecovery, 0);
    }).catch(function(e) { console.error('[IVX] invest load failed', e); });
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
