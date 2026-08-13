/**
 * IVX Web Vitals — Lightweight performance measurement (items 101-103)
 * Collects LCP, INP, CLS, TTFB, and FID using the Web Vitals library pattern.
 * No external dependencies — uses native PerformanceObserver API.
 * Reports to console + IVX.track() + optional beacon endpoint.
 */
(function() {
  'use strict';

  var IVX_PERF_BUDGET = {
    LCP:  2500,  // ms — Largest Contentful Paint
    INP:   200,  // ms — Interaction to Next Paint
    CLS:  0.1,   // score — Cumulative Layout Shift
    TTFB:  800,  // ms — Time to First Byte
    FID:   100,  // ms — First Input Delay (fallback)
    WEIGHT: 250000  // bytes — total JS+CSS+HTML transfer weight budget
  };

  var vitals = {
    lcp:  null,
    inp:  null,
    cls:  0,
    ttfb: null,
    fid:  null
  };

  // TTFB — from Navigation Timing API
  function measureTTFB() {
    if (!performance || !performance.getEntriesByType) return;
    var navEntries = performance.getEntriesByType('navigation');
    if (navEntries.length > 0) {
      var nav = navEntries[0];
      vitals.ttfb = Math.round(nav.responseStart - nav.requestStart);
      if (vitals.ttfb < 0) vitals.ttfb = Math.round(nav.responseStart);
    }
  }

  // LCP — Largest Contentful Paint
  function observeLCP() {
    if (!PerformanceObserver) return;
    try {
      var lcpObserver = new PerformanceObserver(function(list) {
        var entries = list.getEntries();
        if (entries.length > 0) {
          var lastEntry = entries[entries.length - 1];
          vitals.lcp = Math.round(lastEntry.startTime);
        }
      });
      lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
    } catch(e) {}
  }

  // CLS — Cumulative Layout Shift
  function observeCLS() {
    if (!PerformanceObserver) return;
    try {
      var clsObserver = new PerformanceObserver(function(list) {
        var entries = list.getEntries();
        for (var i = 0; i < entries.length; i++) {
          if (!entries[i].hadRecentInput) {
            vitals.cls += entries[i].value;
          }
        }
        vitals.cls = Math.round(vitals.cls * 1000) / 1000;
      });
      clsObserver.observe({ type: 'layout-shift', buffered: true });
    } catch(e) {}
  }

  // INP — Interaction to Next Paint (uses 'event' entries)
  function observeINP() {
    if (!PerformanceObserver) return;
    try {
      var maxDuration = 0;
      var inpObserver = new PerformanceObserver(function(list) {
        var entries = list.getEntries();
        for (var i = 0; i < entries.length; i++) {
          var duration = Math.round(entries[i].duration);
          if (duration > maxDuration) {
            maxDuration = duration;
          }
        }
        vitals.inp = maxDuration;
      });
      inpObserver.observe({ type: 'event', buffered: true });
    } catch(e) {}
  }

  // FID — First Input Delay (fallback for browsers without INP support)
  function observeFID() {
    if (!PerformanceObserver) return;
    try {
      var fidObserver = new PerformanceObserver(function(list) {
        var entries = list.getEntries();
        if (entries.length > 0) {
          vitals.fid = Math.round(entries[0].processingStart - entries[0].startTime);
        }
      });
      fidObserver.observe({ type: 'first-input', buffered: true });
    } catch(e) {}
  }

  // Resource weight — total transfer size of JS, CSS, HTML
  function measureWeight() {
    if (!performance || !performance.getEntriesByType) return 0;
    var resources = performance.getEntriesByType('resource');
    var total = 0;
    for (var i = 0; i < resources.length; i++) {
      var r = resources[i];
      var url = r.name || '';
      // Only count JS, CSS, and HTML resources
      if (url.match(/\.(js|css|html)(\?|$)/) || url.indexOf('cdn.jsdelivr') !== -1) {
        total += (r.transferSize || r.encodedBodySize || 0);
      }
    }
    return total;
  }

  // Report vitals
  function reportVitals() {
    var weight = measureWeight();
    var report = {
      lcp: vitals.lcp,
      inp: vitals.inp,
      cls: vitals.cls,
      ttfb: vitals.ttfb,
      fid: vitals.fid,
      weightBytes: weight,
      weightKB: Math.round(weight / 1024),
      budget: IVX_PERF_BUDGET,
      violations: []
    };

    // Check against budget
    if (vitals.lcp !== null && vitals.lcp > IVX_PERF_BUDGET.LCP) {
      report.violations.push('LCP ' + vitals.lcp + 'ms > ' + IVX_PERF_BUDGET.LCP + 'ms');
    }
    if (vitals.inp !== null && vitals.inp > IVX_PERF_BUDGET.INP) {
      report.violations.push('INP ' + vitals.inp + 'ms > ' + IVX_PERF_BUDGET.INP + 'ms');
    }
    if (vitals.cls > IVX_PERF_BUDGET.CLS) {
      report.violations.push('CLS ' + vitals.cls + ' > ' + IVX_PERF_BUDGET.CLS);
    }
    if (vitals.ttfb !== null && vitals.ttfb > IVX_PERF_BUDGET.TTFB) {
      report.violations.push('TTFB ' + vitals.ttfb + 'ms > ' + IVX_PERF_BUDGET.TTFB + 'ms');
    }
    if (weight > IVX_PERF_BUDGET.WEIGHT) {
      report.violations.push('Weight ' + report.weightKB + 'KB > ' + Math.round(IVX_PERF_BUDGET.WEIGHT / 1024) + 'KB');
    }

    // Log to console
    if (report.violations.length > 0) {
      console.warn('[IVX Perf] BUDGET VIOLATIONS:', report.violations.join(', '));
    } else {
      console.log('[IVX Perf] All metrics within budget');
    }
    console.table(report);

    // Send to IVX analytics
    if (window.IVX && typeof window.IVX.track === 'function') {
      window.IVX.track('web_vitals', report);
    }

    // Send beacon to backend (non-blocking)
    if (navigator && navigator.sendBeacon) {
      var api = document.querySelector('meta[name="ivx-api-url"]');
      var apiUrl = api ? api.content : '';
      if (apiUrl && apiUrl.indexOf('__IVX_') !== 0) {
        try {
          navigator.sendBeacon(apiUrl + '/api/ivx/perf/vitals', JSON.stringify(report));
        } catch(e) {}
      }
    }

    return report;
  }

  // Initialize
  measureTTFB();
  observeLCP();
  observeCLS();
  observeINP();
  observeFID();

  // Report on page visibility change (when user leaves)
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') {
      reportVitals();
    }
  });

  // Also report on load (for debugging)
  window.addEventListener('load', function() {
    setTimeout(reportVitals, 1000);
  });

  // Expose for debugging
  window.IVX_PERF = { vitals: vitals, budget: IVX_PERF_BUDGET, report: reportVitals };
})();
