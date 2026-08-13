/**
 * IVX Analytics Event Layer (items 104-106 — extracted from inline <script>)
 * Centralized, safe, no secrets. Provides IVX.track(), IVX.loadAdPixels(),
 * and auto-tracking helpers.
 *
 * Item 156: PII is sanitized before tracking — emails, phones, account numbers
 * are masked before sending to any analytics platform.
 * Item 171: Consent version, timestamp, and selection are recorded.
 * Item 196: Release version is included in error reports.
 */
window.IVX = window.IVX || {};

// ── Item 156: PII Sanitizer — masks sensitive data before analytics ──────────
IVX._sanitizePII = function(str) {
  if (typeof str !== 'string') return str;
  // Mask email: u***@example.com
  str = str.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, function(m) {
    var parts = m.split('@');
    return parts[0].slice(0, 1) + '***@' + parts[1];
  });
  // Mask phone: +1***5678
  str = str.replace(/(\+?1[-.\s]?)?\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})/g, function(m) {
    var d = m.replace(/\D/g, '');
    return d.length > 4 ? '+' + '*'.repeat(d.length - 4) + d.slice(-4) : '****';
  });
  // Mask SSN
  str = str.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '***-**-****');
  // Mask EIN
  str = str.replace(/\b\d{2}-\d{7}\b/g, '**-*******');
  // Mask account numbers (6+ consecutive digits)
  str = str.replace(/\b\d{6,}\b/g, function(m) {
    return '*'.repeat(m.length - 4) + m.slice(-4);
  });
  return str;
};

IVX._sanitizeData = function(data) {
  if (!data || typeof data !== 'object') return data;
  var result = {};
  for (var key in data) {
    if (typeof data[key] === 'string') {
      result[key] = IVX._sanitizePII(data[key]);
    } else if (typeof data[key] === 'object' && data[key] !== null) {
      result[key] = IVX._sanitizeData(data[key]);
    } else {
      result[key] = data[key];
    }
  }
  return result;
};

// ── Item 196: Release version for error monitoring ────────────────────────────
IVX.RELEASE_VERSION = 'v20260813';

// ── Core tracking function (item 156: PII sanitized) ──────────────────────────
IVX.track = function(eventName, data) {
  data = data || {};
  // Item 156: Sanitize PII before sending to any analytics platform
  data = IVX._sanitizeData(data);
  data.timestamp = new Date().toISOString();
  data.page_url = window.location.href;
  data.page_path = window.location.pathname;
  data.release_version = IVX.RELEASE_VERSION;

  if (typeof window.gtag === 'function') { window.gtag('event', eventName, data); }
  if (typeof window.fbq === 'function') { window.fbq('trackCustom', eventName, data); }
  if (typeof window.ttq === 'object' && typeof window.ttq.track === 'function') { window.ttq.track(eventName, data); }
  if (window.lintrk) { window.lintrk('track', { conversion_id: eventName }); }

  IVX._events = IVX._events || [];
  IVX._events.push({ event: eventName, data: data });
};

IVX.trackPageView = function() {
  IVX.track('landing_page_view', { referrer: document.referrer });
};

IVX._pixelsLoaded = false;

/**
 * Load all ad pixels — gated by cookie consent (items 90-97).
 * Called by acceptCookies() for new users, and on page load for returning users.
 */
IVX.loadAdPixels = function() {
  if (IVX._pixelsLoaded) return;
  IVX._pixelsLoaded = true;

  // Google Ads / GA4
  var gadsKey = (document.querySelector('meta[name="ivx-gads-key"]') || {}).content || '';
  if (gadsKey && gadsKey.indexOf('__IVX_') !== 0 && gadsKey.length > 5) {
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + gadsKey;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function() { dataLayer.push(arguments); };
    gtag('js', new Date());
    gtag('config', gadsKey);
  } else {
    window.gtag = function() {};
  }

  // Meta Pixel
  var metaPixelId = (document.querySelector('meta[name="ivx-meta-pixel-id"]') || {}).content || '';
  if (metaPixelId && metaPixelId.indexOf('__IVX_') !== 0 && metaPixelId.length > 5) {
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
    document,'script','https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', metaPixelId);
    fbq('track', 'PageView');
  } else {
    window.fbq = function() {};
  }

  // TikTok Pixel
  var ttPixelId = (document.querySelector('meta[name="ivx-tiktok-pixel-id"]') || {}).content || '';
  if (ttPixelId && ttPixelId.indexOf('__IVX_') !== 0 && ttPixelId.length > 5) {
    !function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=
    ["page","track","identify","instances","debug","on","off","once","ready","alias",
    "group","enableCookie","disableCookie"],ttq.setAndDefer=function(t,e){t[e]=function(){
    t._q.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;
    i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){
    for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);
    return e};ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";
    ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,
    ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript",
    o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];
    a.parentNode.insertBefore(o,a)};ttq.load(ttPixelId);ttq.page();
    }(window,document,'ttq');
  }

  // LinkedIn Insight Tag
  var liId = (document.querySelector('meta[name="ivx-linkedin-partner-id"]') || {}).content || '';
  if (liId && liId.indexOf('__IVX_') !== 0 && liId.length > 3) {
    _linkedin_partner_id = liId;
    window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];
    window._linkedin_data_partner_ids.push(_linkedin_partner_id);
    (function(l){if(!l){window.lintrk=function(a,b){window.lintrk.q.push([a,b])};
    window.lintrk.q=[]}var s=document.getElementsByTagName("script")[0];
    var b=document.createElement("script");b.type="text/javascript";b.async=true;
    b.src="https://snap.licdn.com/li.lms-analytics/insight.min.js";
    s.parentNode.insertBefore(b,s)})(window.lintrk);
  }

  IVX.trackPageView();
};

// On script execution, load pixels for returning users with prior consent
(function() {
  try {
    if (localStorage.getItem('ivx_cookie_consent') === 'all') {
      IVX.loadAdPixels();
    } else {
      window.gtag = function() {};
      window.fbq = function() {};
    }
  } catch(e) {
    window.gtag = function() {};
    window.fbq = function() {};
  }
})();

// ── Item 171: Consent recording (version, date, selection) ──────────────────
IVX.CONSENT_VERSION = 'v1.0-20260813';
IVX.recordConsent = function(selection) {
  var consent = {
    version: IVX.CONSENT_VERSION,
    selection: selection,
    timestamp: new Date().toISOString(),
    page: window.location.pathname,
  };
  try {
    localStorage.setItem('ivx_cookie_consent', selection);
    localStorage.setItem('ivx_consent_record', JSON.stringify(consent));
  } catch(e) {}
  IVX.track('cookie_consent_recorded', { selection: selection, version: IVX.CONSENT_VERSION });
  return consent;
};

IVX.getConsentRecord = function() {
  try {
    var record = localStorage.getItem('ivx_consent_record');
    return record ? JSON.parse(record) : null;
  } catch(e) {
    return null;
  }
};

// ── Tracking helpers ──────────────────────────────────────────────────────────
IVX.trackCTA = function(ctaName, ctaLocation) {
  IVX.track('primary_cta_click', { cta_name: ctaName, cta_location: ctaLocation });
};
IVX.trackRegStart = function() {
  IVX.track('registration_started', { form: 'smart_funnel' });
};
IVX.trackRegComplete = function(userId) {
  // userId is already sanitized by IVX.track → IVX._sanitizeData
  IVX.track('registration_completed', { user_id: userId || 'anonymous' });
};
IVX.trackAPKDownload = function(action) {
  IVX.track('apk_download_' + (action || 'started'), { platform: 'android' });
};
IVX.trackFormError = function(field, message) {
  IVX.track('form_validation_error', { field: field, message: message });
};
IVX.trackBackendError = function(endpoint, status) {
  // Item 196: Include release version in error reports
  IVX.track('backend_submission_error', { endpoint: endpoint, status: status, release: IVX.RELEASE_VERSION });
};
