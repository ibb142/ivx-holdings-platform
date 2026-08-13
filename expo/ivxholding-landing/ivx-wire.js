/**
 * IVX Wire Instructions (item 104 — extracted from inline <script>)
 * Fetches wire transfer instructions from the authenticated API and renders them.
 * Items 153-154: No hardcoded fallback values — bank details only come from
 * the authenticated API endpoint. Unauthenticated users see a sign-in CTA.
 */
(function() {
  fetch('/api/ivx/wire-instructions').then(function(r) {
    if (r.status === 401) {
      // Not authenticated — show sign-in CTA instead of bank details
      var cta = document.getElementById('wire-cta-btn');
      if (cta) {
        cta.textContent = 'Sign in to view wire instructions';
        cta.href = '/wire-transfer';
      }
      return null;
    }
    return r.json();
  }).then(function(j) {
    if (!j || !j.ok || !j.instructions) return;
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
    // Network error — show CTA to get instructions in the app
    var cta = document.getElementById('wire-cta-btn');
    if (cta) {
      cta.textContent = 'Get wire instructions in the app';
    }
  });
})();
