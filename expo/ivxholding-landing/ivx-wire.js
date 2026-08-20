/**
 * IVX Wire Instructions — bank privacy contract.
 *
 * Full wire details are fetched only with the existing authenticated portal
 * session. Sensitive bank/account values are never written to localStorage.
 * When the session is absent, expired or rejected, the DOM is scrubbed and a
 * sign-in CTA is shown.
 */
(function() {
  'use strict';

  var SENSITIVE_IDS = [
    'wire-bank-name',
    'wire-routing',
    'wire-swift',
    'wire-bank-address',
    'wire-account-name',
    'wire-account-number',
    'wire-beneficiary-address',
    'wire-ref-code'
  ];

  function readPortalToken() {
    try {
      var saved = JSON.parse(localStorage.getItem('ivx_portal_session') || 'null');
      if (!saved || !saved.token || !saved.ts) return '';
      // The portal session itself is one hour; fail closed slightly before expiry.
      if ((Date.now() - Number(saved.ts)) >= 55 * 60 * 1000) return '';
      return String(saved.token);
    } catch (e) {
      return '';
    }
  }

  function scrubWireDetails() {
    SENSITIVE_IDS.forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.textContent = '\u2014';
    });
    var grid = document.getElementById('wire-instructions-grid');
    if (grid) grid.style.display = 'none';
  }

  function showSignInCta(message) {
    scrubWireDetails();
    var cta = document.getElementById('wire-cta-btn');
    if (!cta) return;
    cta.textContent = message || 'Sign in to view secure wire instructions';
    cta.href = '#wire-transfer';
    cta.style.display = 'inline-flex';
  }

  function bindWireCta() {
    var cta = document.getElementById('wire-cta-btn');
    if (!cta || cta.dataset.ivxWireBound === 'true') return;
    cta.dataset.ivxWireBound = 'true';
    cta.addEventListener('click', function(e) {
      e.preventDefault();
      if (typeof window.openPortal === 'function') {
        window.openPortal();
      } else if (window.IVXPortal && typeof window.IVXPortal.open === 'function') {
        window.IVXPortal.open();
      }
    });
  }

  function renderInstructions(i) {
    var set = function(id, val) {
      var el = document.getElementById(id);
      if (el) el.textContent = val || '\u2014';
    };
    set('wire-bank-name', i.bankName);
    set('wire-routing', i.routingNumber);
    set('wire-swift', i.swiftCode);
    set('wire-bank-address', i.bankAddress);
    set('wire-account-name', i.accountName);
    set('wire-account-number', i.accountNumber);
    set('wire-beneficiary-address', i.beneficiaryAddress);
    set('wire-ref-code', i.referenceCode);
    var grid = document.getElementById('wire-instructions-grid');
    if (grid) grid.style.display = 'grid';
    var cta = document.getElementById('wire-cta-btn');
    if (cta) cta.style.display = 'none';
  }

  async function loadWireInstructions() {
    bindWireCta();
    var token = readPortalToken();
    if (!token) {
      showSignInCta();
      return false;
    }

    try {
      var r = await fetch('/api/ivx/wire-instructions', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Accept': 'application/json'
        }
      });

      var j = null;
      try { j = await r.json(); } catch (e) {}
      if (r.status === 401 || r.status === 403 || !j || j.authenticated === false) {
        showSignInCta('Session expired — sign in again');
        return false;
      }
      if (!r.ok || !j.ok || !j.instructions) {
        showSignInCta('Wire instructions temporarily unavailable');
        return false;
      }

      renderInstructions(j.instructions);
      return true;
    } catch (e) {
      showSignInCta('Wire instructions temporarily unavailable');
      return false;
    }
  }

  bindWireCta();
  scrubWireDetails();
  if (location.pathname === '/wire-transfer' || location.hash === '#wire-transfer') {
    var wireSection = document.getElementById('wire-transfer');
    if (wireSection) setTimeout(function() { wireSection.scrollIntoView({ block: 'start' }); }, 0);
  }

  window.IVXReloadWireInstructions = loadWireInstructions;
  window.IVXScrubWireInstructions = scrubWireDetails;
  void loadWireInstructions();
})();
