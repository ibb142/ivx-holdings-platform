/**
 * IVX Wire Instructions (item 104 — extracted from inline <script>)
 * Fetches wire transfer instructions from the authenticated API and renders them.
 * Falls back to CTA pointing to the app if the call fails.
 */
(function() {
  fetch('/api/ivx/wire-instructions').then(function(r) { return r.json(); }).then(function(j) {
    if (!j.ok || !j.instructions) return;
    var i = j.instructions;
    var set = function(id, val) {
      var el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    set('wire-bank-name', i.bankName || 'U.S. Century Bank');
    set('wire-routing', i.routingNumber || '067015397');
    set('wire-swift', i.swiftCode || 'USCEUS3M');
    set('wire-bank-address', i.bankAddress || '2301 NW 87th Ave, Doral, FL 33172');
    set('wire-account-name', i.accountName || 'IVX Holdings');
    set('wire-account-number', i.accountNumber || '1052026057');
    set('wire-beneficiary-address', i.beneficiaryAddress || '1001 Brickell Bay Drive, Suite 2700, Miami, FL 33131');
    set('wire-ref-code', i.referenceCode || '\u2014');
    var grid = document.getElementById('wire-instructions-grid');
    if (grid) grid.style.display = 'grid';
  }).catch(function() {});
})();
