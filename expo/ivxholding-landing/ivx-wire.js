/**
 * IVX Wire Instructions (item 104 — extracted from inline <script>)
 * Fetches wire transfer instructions from the API and renders them.
 * Unauthenticated users see a 200 with preview (bank name + sign-in CTA).
 * Authenticated users get full bank details with routing/account numbers.
 */
(function() {
  function bindWireCta() {
    var cta = document.getElementById('wire-cta-btn');
    if (!cta || cta.dataset.ivxWireBound === 'true') return;
    cta.dataset.ivxWireBound = 'true';
    cta.addEventListener('click', function(e) {
      e.preventDefault();
      if (typeof window.openPortal === 'function') window.openPortal();
    });
  }

  bindWireCta();
  if (location.pathname === '/wire-transfer' || location.hash === '#wire-transfer') {
    var wireSection = document.getElementById('wire-transfer');
    if (wireSection) setTimeout(function() { wireSection.scrollIntoView({ block: 'start' }); }, 0);
  }

  fetch('/api/ivx/wire-instructions').then(function(r) {
    if (!r.ok) {
      // Network/server error — show CTA to get instructions in the app
      var cta = document.getElementById('wire-cta-btn');
      if (cta) {
        cta.textContent = 'Get wire instructions in the app';
      }
      return null;
    }
    return r.json();
  }).then(function(j) {
    if (!j || !j.ok) return;

    // Unauthenticated: show bank name + sign-in CTA
    if (j.authenticated === false && j.preview) {
      var set0 = function(id, val) {
        var el = document.getElementById(id);
        if (el) el.textContent = val || '\u2014';
      };
      set0('wire-bank-name', j.preview.bankName);
      var ctaBtn = document.getElementById('wire-cta-btn');
      if (ctaBtn) {
        ctaBtn.textContent = j.preview.cta || 'Sign in to view wire instructions';
        ctaBtn.href = '/wire-transfer';
        ctaBtn.style.display = 'inline-flex';
      }
      // Show grid with just the bank name visible
      var grid0 = document.getElementById('wire-instructions-grid');
      if (grid0) grid0.style.display = 'grid';
      return;
    }

    // Authenticated: show full bank details
    if (!j.instructions) return;
    var i = j.instructions;
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
  }).catch(function() {
    var cta = document.getElementById('wire-cta-btn');
    if (cta) {
      cta.textContent = 'Get wire instructions in the app';
    }
  });
})();
