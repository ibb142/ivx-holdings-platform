/**
 * IVX UI Utilities (items 104-106 — extracted from inline <script>s)
 * Combines: scroll restoration, focus trap, FAB form-active, and duplicate-submission protection.
 */

// ═══ SCROLL RESTORATION (item 104) ═══
(function() {
  var scrollKey = 'ivx_scroll_' + location.pathname;
  window.addEventListener('pagehide', function() {
    try { sessionStorage.setItem(scrollKey, String(window.scrollY)); } catch(e) {}
  });
  window.addEventListener('pageshow', function(event) {
    if (event.persisted) {
      var saved = sessionStorage.getItem(scrollKey);
      if (saved) { window.scrollTo(0, parseInt(saved, 10) || 0); }
    }
  });
  window.addEventListener('load', function() {
    if (performance && performance.getEntriesByType && performance.getEntriesByType('navigation')[0] && performance.getEntriesByType('navigation')[0].type === 'back_forward') {
      var saved = sessionStorage.getItem(scrollKey);
      if (saved) { window.scrollTo(0, parseInt(saved, 10) || 0); }
    }
  });
})();

// ═══ KEYBOARD NAVIGATION + FOCUS MANAGEMENT (item 137) ═══
(function() {
  function trapFocus(modal) {
    var focusable = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    modal.addEventListener('keydown', function(e) {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }
  var overlays = document.querySelectorAll('.mreg-overlay, .funnel-overlay, [class*="overlay"]');
  var observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mut) {
      if (mut.attributeName === 'class' || mut.attributeName === 'style') {
        var el = mut.target;
        if (el.offsetWidth > 0 && el.offsetHeight > 0) {
          trapFocus(el);
          var firstFocus = el.querySelector('button, input, [href]');
          if (firstFocus) firstFocus.focus();
        }
      }
    });
  });
  overlays.forEach(function(el) {
    observer.observe(el, { attributes: true });
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      var openOverlay = document.querySelector('.mreg-overlay.mreg-open, .funnel-overlay[style*="flex"], .partner-overlay.open, .legal-overlay.open, .portal-overlay[style*="flex"]');
      if (openOverlay) {
        var closeBtn = openOverlay.querySelector('[onclick*="close"], .mreg-close, .funnel-close, .partner-close, .legal-close, .portal-close');
        if (closeBtn) closeBtn.click();
      }
    }
  });
})();

// ═══ FAB FORM-ACTIVE (item 138) ═══
(function() {
  document.addEventListener('focusin', function(e) {
    if (e.target.matches('input, textarea, select, [contenteditable]')) {
      document.body.classList.add('form-active');
    }
  });
  document.addEventListener('focusout', function(e) {
    if (!e.target.matches('input, textarea, select, [contenteditable]')) {
      document.body.classList.remove('form-active');
    }
  });
})();

// ═══ DUPLICATE-SUBMISSION PROTECTION (item 88) ═══
(function() {
  var form = document.getElementById('funnel-form');
  if (!form) return;
  var submitted = false;
  form.addEventListener('submit', function(e) {
    if (submitted) {
      e.preventDefault();
      return false;
    }
    submitted = true;
    var btn = document.getElementById('funnel-submit-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Submitting\u2026';
      btn.style.opacity = '0.6';
    }
    setTimeout(function() {
      submitted = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Start Investor Review \u2192';
        btn.style.opacity = '1';
      }
    }, 10000);
  });
})();

// ═══ PAID-TRAFFIC APK SAFETY GATE ═══
// Never send paid landing traffic to a stale Android binary. Until the
// Home-recovery APK is independently certified and promoted, convert every
// versioned APK CTA into a non-download status card and hide its QR code.
(function() {
  function gateStaleApkLinks() {
    var links = document.querySelectorAll('a[href*="/apk/ivx-holdings-v1."]');
    links.forEach(function(link) {
      link.setAttribute('href', '#app-coming-soon');
      link.setAttribute('aria-label', 'Android update in progress');
      link.removeAttribute('download');
      link.addEventListener('click', function() {
        var target = document.getElementById('app-coming-soon');
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      var small = link.querySelector('small');
      var strong = link.querySelector('strong');
      if (small) small.textContent = 'Update in progress';
      if (strong) strong.textContent = 'Android';
    });

    document.querySelectorAll('img[src*="ivx-holdings-v1."][src*="qrserver.com"]').forEach(function(img) {
      var wrap = img.closest('.app-store-qr, .app-badge-qr');
      if (wrap) wrap.style.display = 'none';
    });

    document.querySelectorAll('.app-download-note, .app-banner-countdown').forEach(function(note) {
      note.textContent = 'Android update is being certified. Investor intake and web access remain live.';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', gateStaleApkLinks);
  } else {
    gateStaleApkLinks();
  }
})();
