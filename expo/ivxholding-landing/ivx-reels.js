/*
 * IVX Reels — enterprise full-screen vertical video experience for ivxholding.com.
 *
 * Instagram-grade behaviors on top of the IVX video platform API:
 *   full-screen snap feed · infinite scroll · autoplay/pause · adaptive HLS
 *   double-tap like · comments · share · save · follow · stories · live row
 *   audience channels (Investor / Buyer / Realtor / Builder / JV Deals)
 *   personalized ranking (viewer id + zip + watch history) · analytics beacons
 *   upload with progress (mobile + desktop) · creator dashboard · report
 */
(function () {
  'use strict';
  if (window.__ivxReelsLoaded) return;
  window.__ivxReelsLoaded = true;

  /* ---------- config ---------- */
  /*
   * API resolution — the static landing host (ivxholding.com on S3) answers every
   * /api/* path with index.html, which is NOT an API. We must always talk to the
   * real backend. Preference order:
   *   1. meta[ivx-backend-url]   (real backend, e.g. https://api.ivxholding.com)
   *   2. meta[ivx-api-url]       (only if it is not the static site itself)
   *   3. https://api.ivxholding.com
   * Plus runtime failover: if a feed response is not JSON (static-site HTML) or
   * the request fails, the next candidate host is promoted automatically.
   */
  var PROD_API = 'https://api.ivxholding.com';
  var RENDER_API = 'https://ivx-holdings-platform.onrender.com';
  function readMeta(name) {
    var m = document.querySelector('meta[name="' + name + '"]');
    var v = (m && m.getAttribute('content')) || '';
    v = v.trim().replace(/\/+$/, '');
    if (!v || v.indexOf('__IVX') === 0) return '';
    return v;
  }
  function isStaticSiteHost(url) {
    try {
      var h = new URL(url).host.toLowerCase();
      if (h === 'ivxholding.com' || h === 'www.ivxholding.com') return true;
      if (location.host && h === location.host.toLowerCase()) return true;
      return false;
    } catch (e) { return true; }
  }
  var API = readMeta('ivx-backend-url') || readMeta('ivx-api-url') || PROD_API;
  if (isStaticSiteHost(API)) API = PROD_API;
  var API_CANDIDATES = [API, PROD_API, RENDER_API].filter(function (v, i, a) { return v && a.indexOf(v) === i; });

  var HLS_CDN = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js';
  /*
   * Channels — '' is the CANONICAL unified feed (identical order on landing,
   * Android, iOS, Expo): 3 investor deal videos → 1 Featured Investor Video →
   * repeat. '__reels' is the Project Reels rail (?type=reel) — construction
   * updates never interrupt the investor deal flow.
   */
  var CHANNELS = [
    { id: '', label: 'Deals' },
    { id: '__reels', label: 'Project Reels' },
    { id: 'investor', label: 'Investor' },
    { id: 'buyer', label: 'Buyer' },
    { id: 'realtor', label: 'Realtor' },
    { id: 'builder', label: 'Builder' },
    { id: 'jv', label: 'JV Deals' }
  ];

  function viewerId() {
    try {
      var id = localStorage.getItem('ivx_viewer_id');
      if (!id) {
        id = 'guest-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        localStorage.setItem('ivx_viewer_id', id);
      }
      return id;
    } catch (e) { return 'guest-anon'; }
  }
  var VIEWER = viewerId();

  /* ---------- analytics beacon queue ---------- */
  var eventQueue = [];
  function track(ev) {
    ev.viewer_id = VIEWER;
    eventQueue.push(ev);
    if (eventQueue.length >= 10) flushEvents(false);
    /* Bridge to ad platform + first-party analytics */
    try {
      var evType = ev.type || '';
      var vidId = ev.video_id || '';
      if (typeof ivxTrack === 'function') {
        var trackMap = {
          'view': 'reel_view',
          'complete': 'reel_complete',
          'share': 'reel_share'
        };
        if (trackMap[evType]) ivxTrack(trackMap[evType], { video_id: vidId, watch_ms: ev.watch_ms || null });
      }
      if (typeof fireAdEvent === 'function') {
        if (evType === 'view') fireAdEvent('view_content', { content_name: 'reel', property_id: vidId, category: 'reel' });
        if (evType === 'complete') fireAdEvent('view_content', { content_name: 'reel_complete', property_id: vidId, category: 'reel_engagement' });
      }
    } catch(e) {}
  }
  function flushEvents(useBeacon) {
    if (eventQueue.length === 0) return;
    var payload = JSON.stringify({ events: eventQueue.splice(0, eventQueue.length) });
    var url = API + '/api/ivx/video-platform/events';
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
    } else {
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload }).catch(function () {});
    }
  }
  setInterval(function () { flushEvents(false); }, 5000);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      flushEvents(true);
      deactivateCurrent();
    }
  });
  window.addEventListener('pagehide', function () { flushEvents(true); });

  /* ---------- HLS ---------- */
  var hlsLoading = null;
  function loadHlsJs() {
    if (window.Hls) return Promise.resolve();
    if (hlsLoading) return hlsLoading;
    hlsLoading = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = HLS_CDN; s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { resolve(); };
      document.head.appendChild(s);
    });
    return hlsLoading;
  }
  function attachSource(video, hlsUrl, fallbackUrl) {
    if (video.__ivxAttached) return;
    video.__ivxAttached = true;
    if (!hlsUrl) { if (fallbackUrl) video.src = fallbackUrl; return; }
    if (video.canPlayType('application/vnd.apple.mpegurl')) { video.src = hlsUrl; return; }
    loadHlsJs().then(function () {
      if (window.Hls && window.Hls.isSupported()) {
        var h = new window.Hls({ capLevelToPlayerSize: true, autoStartLoad: true, maxBufferLength: 15 });
        h.on(window.Hls.Events.ERROR, function (_e, data) {
          if (data && data.fatal) { try { h.destroy(); } catch (e) {} if (fallbackUrl) video.src = fallbackUrl; }
        });
        h.loadSource(hlsUrl);
        h.attachMedia(video);
        video.__ivxHls = h;
      } else if (fallbackUrl) {
        video.src = fallbackUrl;
      }
    });
  }

  /* ---------- styles ---------- */
  var css = ''
    + '#ivxReelsBtn{position:fixed;left:16px;bottom:18px;z-index:99990;display:flex;align-items:center;gap:8px;'
    + 'background:linear-gradient(135deg,#E6C200,#E6C200);color:#fff;border:none;border-radius:999px;padding:12px 20px;'
    + 'font:600 15px/1 -apple-system,Segoe UI,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35);cursor:pointer;transition:transform .15s}'
    + '#ivxReelsBtn:active{transform:scale(.94)}'
    + '#ivxReels{position:fixed;inset:0;z-index:99991;background:#000;display:none;flex-direction:column}'
    + '#ivxReels.open{display:flex}'
    + '.ivxr-top{position:absolute;top:0;left:0;right:0;z-index:30;padding:calc(10px + env(safe-area-inset-top)) 10px 10px;'
    + 'background:linear-gradient(rgba(0,0,0,.65),transparent);display:flex;flex-direction:column;gap:8px}'
    + '.ivxr-row{display:flex;align-items:center;gap:8px}'
    + '.ivxr-tabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;flex:1}'
    + '.ivxr-tabs::-webkit-scrollbar{display:none}'
    + '.ivxr-tab{flex:0 0 auto;background:rgba(0,0,0,.35);color:#fff;border:none;border-radius:999px;padding:7px 14px;'
    + 'font:700 13px/1 -apple-system,Segoe UI,sans-serif;cursor:pointer;text-shadow:0 1px 3px rgba(0,0,0,.6)}'
    + '.ivxr-tab.on{background:#fff;color:#000;text-shadow:none}'
    + '.ivxr-ico{background:rgba(0,0,0,.35);color:#fff;border:none;border-radius:50%;width:38px;height:38px;'
    + 'font-size:19px;line-height:1;cursor:pointer;flex:0 0 auto;display:flex;align-items:center;justify-content:center}'
    + '.ivxr-stories{display:flex;gap:10px;overflow-x:auto;scrollbar-width:none;padding:2px 2px 4px}'
    + '.ivxr-stories::-webkit-scrollbar{display:none}'
    + '.ivxr-story{flex:0 0 auto;width:58px;text-align:center;background:none;border:none;cursor:pointer;padding:0}'
    + '.ivxr-story img{width:54px;height:54px;border-radius:50%;object-fit:cover;border:2.5px solid #E6C200;padding:2px;background:#000}'
    + '.ivxr-story span{display:block;color:#fff;font:500 10px/1.2 -apple-system,sans-serif;margin-top:3px;overflow:hidden;'
    + 'text-overflow:ellipsis;white-space:nowrap}'
    + '.ivxr-feed{flex:1;overflow-y:scroll;scroll-snap-type:y mandatory;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}'
    + '.ivxr-slide{position:relative;height:100%;scroll-snap-align:start;scroll-snap-stop:always;display:flex;'
    + 'align-items:center;justify-content:center;background:#000;overflow:hidden}'
    + '.ivxr-slide video{width:100%;height:100%;object-fit:contain;background:#000}'
    + '.ivxr-slide.portrait video{object-fit:cover}'
    + '.ivxr-meta{position:absolute;left:14px;right:84px;bottom:calc(22px + env(safe-area-inset-bottom));z-index:20;color:#fff;'
    + 'text-shadow:0 1px 4px rgba(0,0,0,.7);pointer-events:none}'
    + '.ivxr-meta .t{font:700 16px/1.3 -apple-system,Segoe UI,sans-serif;margin-bottom:4px}'
    + '.ivxr-meta .s{font:400 12.5px/1.4 -apple-system,sans-serif;opacity:.9}'
    + '.ivxr-badge{display:inline-block;background:rgba(218,165,32,.9);border-radius:5px;padding:2px 7px;'
    + 'font:700 10px/1.4 -apple-system,sans-serif;text-transform:uppercase;letter-spacing:.4px;margin-right:5px}'
    + '.ivxr-badge.live{background:#e0245e}'
    + '.ivxr-rail{position:absolute;right:8px;bottom:calc(30px + env(safe-area-inset-bottom));z-index:20;display:flex;'
    + 'flex-direction:column;gap:16px;align-items:center}'
    + '.ivxr-act{background:none;border:none;color:#fff;cursor:pointer;text-align:center;padding:0;'
    + 'filter:drop-shadow(0 1px 3px rgba(0,0,0,.6))}'
    + '.ivxr-act .i{font-size:27px;line-height:1;display:block;transition:transform .12s}'
    + '.ivxr-act:active .i{transform:scale(1.25)}'
    + '.ivxr-act .c{font:600 11px/1 -apple-system,sans-serif;margin-top:4px;display:block}'
    + '.ivxr-act.on .i{color:#e0245e}'
    + '.ivxr-act.saved .i{color:#E6C200}'
    + '.ivxr-follow{background:#E6C200;color:#000;border:none;border-radius:999px;padding:6px 12px;'
    + 'font:700 11px/1 -apple-system,sans-serif;cursor:pointer}'
    + '.ivxr-follow.on{background:rgba(255,255,255,.2);color:#fff}'
    + '.ivxr-heart{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) scale(0);font-size:96px;z-index:25;'
    + 'pointer-events:none;color:#e0245e;filter:drop-shadow(0 2px 12px rgba(0,0,0,.5))}'
    + '.ivxr-heart.burst{animation:ivxHeart .8s ease forwards}'
    + '@keyframes ivxHeart{0%{transform:translate(-50%,-50%) scale(0);opacity:0}25%{transform:translate(-50%,-50%) scale(1.25);opacity:1}'
    + '55%{transform:translate(-50%,-50%) scale(1);opacity:1}100%{transform:translate(-50%,-70%) scale(1);opacity:0}}'
    + '.ivxr-mute{position:absolute;top:calc(112px + env(safe-area-inset-top));right:12px;z-index:20;background:rgba(0,0,0,.5);'
    + 'color:#fff;border:none;border-radius:50%;width:36px;height:36px;font-size:16px;cursor:pointer}'
    + '.ivxr-prog{position:absolute;bottom:0;left:0;right:0;height:3px;background:rgba(255,255,255,.2);z-index:21}'
    + '.ivxr-prog>div{height:100%;width:0;background:#E6C200}'
    + '.ivxr-spin{position:absolute;top:50%;left:50%;width:38px;height:38px;margin:-19px;border:3px solid rgba(255,255,255,.25);'
    + 'border-top-color:#E6C200;border-radius:50%;animation:ivxSpin .8s linear infinite;z-index:15}'
    + '@keyframes ivxSpin{to{transform:rotate(360deg)}}'
    + '.ivxr-empty{color:#aaa;font:500 15px/1.5 -apple-system,sans-serif;text-align:center;padding:40px 30px}'
    + '.ivxr-sheet{position:absolute;left:0;right:0;bottom:0;max-height:65%;background:#141414;border-radius:18px 18px 0 0;'
    + 'z-index:40;display:none;flex-direction:column;color:#fff;font-family:-apple-system,Segoe UI,sans-serif}'
    + '.ivxr-sheet.open{display:flex}'
    + '.ivxr-sheet .hd{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;'
    + 'border-bottom:1px solid rgba(255,255,255,.08);font:700 15px/1 -apple-system,sans-serif}'
    + '.ivxr-sheet .bd{flex:1;overflow-y:auto;padding:10px 16px}'
    + '.ivxr-cmt{padding:9px 0;border-bottom:1px solid rgba(255,255,255,.05)}'
    + '.ivxr-cmt .a{font:700 12.5px/1 -apple-system,sans-serif;color:#E6C200;margin-bottom:3px}'
    + '.ivxr-cmt .b{font:400 13.5px/1.45 -apple-system,sans-serif}'
    + '.ivxr-in{display:flex;gap:8px;padding:10px 12px calc(12px + env(safe-area-inset-bottom));'
    + 'border-top:1px solid rgba(255,255,255,.08)}'
    + '.ivxr-in input{flex:1;background:#242424;border:1px solid rgba(255,255,255,.12);border-radius:999px;color:#fff;'
    + 'padding:10px 15px;font:400 14px/1 -apple-system,sans-serif;outline:none}'
    + '.ivxr-in button{background:#E6C200;color:#000;border:none;border-radius:999px;padding:0 18px;'
    + 'font:700 13px/1 -apple-system,sans-serif;cursor:pointer}'
    + '.ivxr-toast{position:absolute;bottom:100px;left:50%;transform:translateX(-50%);background:rgba(20,20,20,.92);color:#fff;'
    + 'border-radius:999px;padding:10px 18px;font:600 13px/1 -apple-system,sans-serif;z-index:60;pointer-events:none;'
    + 'opacity:0;transition:opacity .25s;white-space:nowrap}'
    + '.ivxr-toast.on{opacity:1}'
    + '.ivxr-up{padding:6px 0}'
    + '.ivxr-up .bar{height:6px;background:#242424;border-radius:999px;overflow:hidden;margin:8px 0}'
    + '.ivxr-up .bar>div{height:100%;width:0;background:#E6C200;transition:width .2s}'
    + '.ivxr-dashrow{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05);'
    + 'font:400 13px/1.4 -apple-system,sans-serif}'
    + '.ivxr-kpis{display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap}'
    + '.ivxr-kpi{flex:1;min-width:90px;background:#242424;border-radius:12px;padding:10px}'
    + '.ivxr-kpi .v{font:800 18px/1 -apple-system,sans-serif;color:#E6C200}'
    + '.ivxr-kpi .l{font:500 10.5px/1 -apple-system,sans-serif;color:#999;margin-top:5px;text-transform:uppercase}'
    + '.ivxr-invest-card{position:absolute;left:14px;right:14px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:20;background:rgba(20,20,20,.92);border-radius:16px;padding:14px 16px 16px;box-shadow:0 8px 32px rgba(0,0,0,.5);color:#fff}'
    + '.ivxr-invest-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:2px}'
    + '.ivxr-invest-title{font:800 18px/1.2 -apple-system,Segoe UI,sans-serif;color:#fff}'
    + '.ivxr-invest-active{font:800 10px/1 -apple-system,sans-serif;color:#E6C200;border:1px solid #E6C200;border-radius:5px;padding:3px 8px;text-transform:uppercase;letter-spacing:.4px}'
    + '.ivxr-invest-loc{font:500 13px/1.3 -apple-system,sans-serif;color:rgba(255,255,255,.85);margin-top:3px}'
    + '.ivxr-invest-metrics{display:flex;gap:22px;margin-top:10px}'
    + '.ivxr-invest-metric{text-align:center}'
    + '.ivxr-invest-metric .v{font:800 22px/1 -apple-system,sans-serif;color:#E6C200}'
    + '.ivxr-invest-metric .l{font:500 10px/1 -apple-system,sans-serif;color:rgba(255,255,255,.7);margin-top:5px;text-transform:uppercase;letter-spacing:.3px}'
    + '.ivxr-invest-options{display:flex;gap:18px;margin-top:12px}'
    + '.ivxr-invest-opt{display:flex;flex-direction:column;align-items:center;gap:4px}'
    + '.ivxr-invest-opt .circ{width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35);border:1.5px solid rgba(255,255,255,.25)}'
    + '.ivxr-invest-opt .circ.yellow{border-color:#E6C200;color:#E6C200}'
    + '.ivxr-invest-opt .circ.blue{border-color:#4A90D9;color:#4A90D9}'
    + '.ivxr-invest-opt .circ.green{border-color:#3CCF4E;color:#3CCF4E}'
    + '.ivxr-invest-opt .lab{font:600 10px/1 -apple-system,sans-serif;color:#fff}'
    + '.ivxr-invest-ctas{display:flex;gap:10px;margin-top:14px}'
    + '.ivxr-invest-cta{flex:1;text-align:center;padding:12px 0;border-radius:999px;font:700 15px/1 -apple-system,Segoe UI,sans-serif;cursor:pointer}'
    + '.ivxr-invest-cta.view{background:rgba(0,0,0,.45);border:1.5px solid #E6C200;color:#E6C200}'
    + '.ivxr-invest-cta.invest{background:#E6C200;color:#000}';
  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  /* ---------- DOM scaffold ---------- */
  var launch = document.createElement('button');
  launch.id = 'ivxReelsBtn';
  launch.innerHTML = '&#9654;&#65039; <span>Reels</span>';
  launch.setAttribute('aria-label', 'Open IVX video reels');
  document.body.appendChild(launch);

  var root = document.createElement('div');
  root.id = 'ivxReels';
  root.innerHTML = ''
    + '<div class="ivxr-top">'
    + '  <div class="ivxr-row">'
    + '    <button class="ivxr-ico" data-r="close" aria-label="Close">&#10005;</button>'
    + '    <div class="ivxr-tabs" data-r="tabs"></div>'
    + '    <button class="ivxr-ico" data-r="upload" aria-label="Upload video">&#65291;</button>'
    + '    <button class="ivxr-ico" data-r="dash" aria-label="Creator dashboard">&#128202;</button>'
    + '  </div>'
    + '  <div class="ivxr-stories" data-r="stories" style="display:none"></div>'
    + '</div>'
    + '<div class="ivxr-feed" data-r="feed"></div>'
    + '<div class="ivxr-sheet" data-r="sheet">'
    + '  <div class="hd"><span data-r="sheetTitle">Comments</span><button class="ivxr-ico" data-r="sheetClose">&#10005;</button></div>'
    + '  <div class="bd" data-r="sheetBody"></div>'
    + '  <div class="ivxr-in" data-r="sheetInput" style="display:none">'
    + '    <input type="text" maxlength="2000" placeholder="Add a comment..." data-r="cmtText" />'
    + '    <button data-r="cmtSend">Post</button>'
    + '  </div>'
    + '</div>'
    + '<div class="ivxr-toast" data-r="toast"></div>'
    + '<input type="file" accept="video/mp4,video/quicktime,video/*" style="display:none" data-r="file" />';
  document.body.appendChild(root);

  function el(name) { return root.querySelector('[data-r="' + name + '"]'); }
  var feedEl = el('feed');
  var sheetEl = el('sheet');

  var toastTimer = null;
  function toast(msg) {
    var t = el('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 2200);
  }

  /* ---------- state ---------- */
  var state = {
    channel: '',
    cursor: null,
    loading: false,
    done: false,
    videos: {},
    activeSlide: null,
    activeSince: 0,
    viewTimer: null,
    muted: true,
    storyMode: false
  };

  /* ---------- tabs ---------- */
  var tabsEl = el('tabs');
  CHANNELS.forEach(function (ch) {
    var b = document.createElement('button');
    b.className = 'ivxr-tab' + (ch.id === '' ? ' on' : '');
    b.textContent = ch.label;
    b.addEventListener('click', function () {
      if (state.channel === ch.id) return;
      state.channel = ch.id;
      tabsEl.querySelectorAll('.ivxr-tab').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      resetFeed();
      loadMore();
    });
    tabsEl.appendChild(b);
  });

  /* ---------- feed loading ---------- */
  function resetFeed() {
    deactivateCurrent();
    feedEl.innerHTML = '';
    state.cursor = null;
    state.done = false;
    state.videos = {};
    state.storyMode = false;
  }

  function feedPath() {
    var u = '/api/ivx/video-platform/feed?limit=6&viewer_id=' + encodeURIComponent(VIEWER);
    if (state.channel === '__reels') u += '&type=reel';
    else if (state.channel) u += '&channel=' + encodeURIComponent(state.channel);
    if (state.cursor) u += '&cursor=' + encodeURIComponent(state.cursor);
    return u;
  }

  /**
   * Fetch a JSON API path with host failover. The static S3 site returns
   * index.html (text/html) for unknown paths — that is treated as a miss and the
   * next candidate host is tried. The first host that answers valid JSON is
   * promoted to `API` so all subsequent calls (likes, comments, upload, events)
   * use the working backend.
   */
  function apiFetchJson(path, hostIdx) {
    hostIdx = hostIdx || 0;
    if (hostIdx >= API_CANDIDATES.length) return Promise.reject(new Error('all API hosts failed'));
    var base = API_CANDIDATES[hostIdx];
    var url = base + path;
    /* AbortController timeout so a hung request does not freeze the UI forever. */
    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 15000);
    return fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
      .then(function (r) {
        clearTimeout(timeout);
        if (!r.ok) throw new Error('bad status ' + r.status);
        return r.text().then(function (text) {
          /* Accept JSON even if the Content-Type header is missing or transformed. */
          var data;
          try { data = JSON.parse(text); } catch (e) { throw new Error('not json'); }
          if (API !== base) API = base; /* promote working host */
          return data;
        });
      })
      .catch(function (err) {
        clearTimeout(timeout);
        /* Do not swallow abort of the final host; surface it. */
        if (hostIdx >= API_CANDIDATES.length - 1) throw err;
        return apiFetchJson(path, hostIdx + 1);
      });
  }

  function showFeedError() {
    if (feedEl.children.length) { toast('Feed failed to load'); return; }
    var em = document.createElement('div');
    em.className = 'ivxr-slide';
    em.innerHTML = '<div class="ivxr-empty">Feed failed to load.<br/><br/>'
      + '<button class="ivxr-retry" style="background:#E6C200;color:#000;border:none;border-radius:999px;'
      + 'padding:12px 28px;font:700 15px/1 -apple-system,Segoe UI,sans-serif;cursor:pointer">Retry</button></div>';
    em.querySelector('.ivxr-retry').addEventListener('click', function () {
      resetFeed();
      loadMore();
    });
    feedEl.appendChild(em);
  }

  function loadMore() {
    if (state.loading || state.done) return;
    state.loading = true;
    var spin = document.createElement('div');
    spin.className = 'ivxr-spin';
    var spinAdded = false;
    if (!feedEl.children.length) { feedEl.appendChild(spin); spinAdded = true; }
    var currentPath = feedPath();
    var removed = false;
    function removeSpin() { if (!removed && spin.parentNode) { spin.parentNode.removeChild(spin); removed = true; } }

    apiFetchJson(currentPath)
      .then(function (data) {
        removeSpin();
        var vids = (data && data.videos) || [];
        // Fallback: if the dedicated Project Reels rail is empty, serve the unified
        // investor feed so the Reels surface never appears broken to visitors.
        if (state.channel === '__reels' && vids.length === 0 && !state.cursor) {
          return apiFetchJson('/api/ivx/video-platform/feed?limit=6&viewer_id=' + encodeURIComponent(VIEWER))
            .then(function (fbData) {
              var fbVids = (fbData && fbData.videos) || [];
              fbVids.forEach(function (v) {
                if (state.videos[v.id]) return;
                state.videos[v.id] = v;
                feedEl.appendChild(buildSlide(v, false));
              });
              state.cursor = fbData && fbData.next_cursor;
              if (!state.cursor) state.done = true;
              finishLoad();
            })
            .catch(function () {
              showFeedError();
              finishLoad();
            });
        }
        vids.forEach(function (v) {
          if (state.videos[v.id]) return;
          state.videos[v.id] = v;
          feedEl.appendChild(buildSlide(v, false));
        });
        state.cursor = data && data.next_cursor;
        if (!state.cursor) state.done = true;
        finishLoad();
      })
      .catch(function () {
        removeSpin();
        showFeedError();
        finishLoad();
      });

    function finishLoad() {
      state.loading = false;
      if (!feedEl.children.length) {
        var em = document.createElement('div');
        em.className = 'ivxr-slide';
        em.innerHTML = '<div class="ivxr-empty">No videos in this channel yet.<br/>Tag videos with audiences or upload a new one with &#65291;.</div>';
        feedEl.appendChild(em);
      }
      observeSlides();
    }
  }

  /* ---------- slide construction ---------- */
  function fmtCount(n) {
    n = Number(n) || 0;
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }

  function parseMetric(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return isNaN(n) || n <= 0 ? null : n;
  }

  function formatRoi(n) {
    if (n == null) return '';
    if (n >= 100) return Math.round(n) + '%';
    return n.toFixed(n % 1 === 0 ? 0 : 2) + '%';
  }

  function formatCurrencyCompact(n) {
    if (n == null) return '';
    if (n >= 1000000) return '$' + (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1) + 'M';
    if (n >= 1000) return '$' + (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'K';
    return '$' + Math.round(n).toLocaleString();
  }

  function parseReelTitle(v) {
    var raw = v.title || (v.deal && v.deal.title) || 'IVX Property Video';
    var title = raw;
    var subtitle = 'Property Tour';
    var location = null;
    var locMatch = raw.match(/(.+?)\s*[—–]\s*([^,]+,\s*[A-Z]{2})/);
    if (locMatch) {
      title = locMatch[1].trim();
      location = locMatch[2].trim();
    } else {
      var tourMatch = raw.match(/(.+?)\s*[—–]\s*(.+)/);
      if (tourMatch) {
        title = tourMatch[1].trim();
        var tour = tourMatch[2].trim();
        if (/^\d+/.test(tour)) {
          location = tour;
          subtitle = 'Property Tour';
        } else if (/^\$/.test(tour)) {
          subtitle = tour;
        } else {
          subtitle = tour;
        }
      }
    }
    if (!location && v.deal) {
      var d = v.deal;
      if (d.city && d.state) location = d.city + ', ' + d.state;
      else if (d.location) location = d.location;
      else if (d.address) location = d.address;
    }
    if (!location && v.city && v.state) location = v.city + ', ' + v.state;
    return { title: title, subtitle: subtitle, location: location };
  }

  function computeMinOwnership(minInvest, price) {
    var min = parseMetric(minInvest);
    var p = parseMetric(price);
    if (!min || !p || p <= 0) return null;
    return ((min / p) * 100).toFixed(4) + '%';
  }

  function buildInvestmentOptions(dealType) {
    var t = (dealType || '').toLowerCase();
    var hex = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>';
    var users = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>';
    var home = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>';
    var tokenized = { icon: hex, label: 'Tokenized', cls: 'yellow' };
    var jvDeals = { icon: users, label: 'JV Deal', cls: 'blue' };
    var buyers = { icon: home, label: 'Buyer', cls: 'green' };
    switch (t) {
      case 'jv':
      case 'equity_split':
      case 'hybrid':
        return [tokenized, jvDeals, buyers];
      case 'development':
      case 'new_construction':
      case 'rehab_construction':
        return [jvDeals, tokenized, buyers];
      case 'profit_sharing':
        return [tokenized, buyers, jvDeals];
      default:
        return [tokenized, jvDeals, buyers];
    }
  }

  function buildSlide(v, isLive) {
    var slide = document.createElement('div');
    slide.className = 'ivxr-slide' + (v.orientation === 'portrait' ? ' portrait' : '');
    slide.__video = v;

    var vid = document.createElement('video');
    vid.setAttribute('playsinline', '');
    vid.muted = true;
    vid.loop = !isLive;
    vid.preload = 'none';
    if (v.preview_blur_url) {
      slide.style.backgroundImage = 'url(' + v.preview_blur_url + ')';
      slide.style.backgroundSize = 'cover';
      slide.style.backgroundPosition = 'center';
    }
    if (v.poster_url || v.thumbnail_url || v.preview_blur_url) vid.poster = v.poster_url || v.thumbnail_url || v.preview_blur_url;
    slide.appendChild(vid);

    /* playback failure → visible retry */
    vid.addEventListener('error', function () {
      if (slide.querySelector('.ivxr-vidretry')) return;
      var rb = document.createElement('button');
      rb.className = 'ivxr-vidretry';
      rb.textContent = 'Video failed — tap to retry';
      rb.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:25;'
        + 'background:rgba(0,0,0,.75);color:#fff;border:1px solid #E6C200;border-radius:999px;padding:12px 22px;'
        + 'font:600 14px/1 -apple-system,Segoe UI,sans-serif;cursor:pointer';
      rb.addEventListener('click', function (e) {
        e.stopPropagation();
        rb.remove();
        vid.__ivxAttached = false;
        if (vid.__ivxHls) { try { vid.__ivxHls.destroy(); } catch (err) {} vid.__ivxHls = null; }
        vid.removeAttribute('src');
        attachSource(vid, v.hls_url, v.video_url);
        vid.play().catch(function () {});
      });
      slide.appendChild(rb);
    });

    var heart = document.createElement('div');
    heart.className = 'ivxr-heart';
    heart.innerHTML = '&#10084;';
    slide.appendChild(heart);

    var parsed = parseReelTitle(v);
    var deal = v.deal || null;
    var hasDeal = !!deal && !!deal.id;
    var roi = parseMetric(deal && deal.expected_roi);
    var minInvest = parseMetric(deal && deal.min_investment);
    var minOwnership = computeMinOwnership(deal && deal.min_investment, deal && deal.price);
    var status = (deal && deal.status) || (v && v.status) || 'published';
    var isActive = status === 'published' || status === 'active';
    var dealType = ((deal && deal.deal_type) || (v && v.deal_type) || '').toLowerCase();
    var investmentOptions = buildInvestmentOptions(dealType);

    var card = document.createElement('div');
    card.className = 'ivxr-invest-card';
    var cardHtml = '';
    cardHtml += '<div class="ivxr-invest-head">'
      + '<div class="ivxr-invest-title">' + escapeHtml(parsed.title) + '</div>'
      + (isActive ? '<div class="ivxr-invest-active">ACTIVE</div>' : '')
      + '</div>';
    if (parsed.location) cardHtml += '<div class="ivxr-invest-loc">' + escapeHtml(parsed.location) + '</div>';
    if (hasDeal && (roi || minInvest || minOwnership)) {
      cardHtml += '<div class="ivxr-invest-metrics">';
      if (roi) cardHtml += '<div class="ivxr-invest-metric"><div class="v">' + escapeHtml(formatRoi(roi)) + '</div><div class="l">ROI</div></div>';
      if (minInvest) cardHtml += '<div class="ivxr-invest-metric"><div class="v">' + escapeHtml(formatCurrencyCompact(minInvest)) + '</div><div class="l">MIN INVEST</div></div>';
      if (minOwnership) cardHtml += '<div class="ivxr-invest-metric"><div class="v">' + escapeHtml(minOwnership) + '</div><div class="l">MIN OWNERSHIP</div></div>';
      cardHtml += '</div>';
    }
    if (investmentOptions.length) {
      cardHtml += '<div class="ivxr-invest-options">' + investmentOptions.map(function (opt) {
        return '<div class="ivxr-invest-opt"><div class="circ ' + opt.cls + '">' + opt.icon + '</div><div class="lab">' + escapeHtml(opt.label) + '</div></div>';
      }).join('') + '</div>';
    }
    if (hasDeal) {
      var dealUrl = deal.url || 'https://ivxholding.com/invest/' + encodeURIComponent(deal.id);
      cardHtml += '<div class="ivxr-invest-ctas">'
        + '<button class="ivxr-invest-cta view" data-r="view-deal">View Deal</button>'
        + '<button class="ivxr-invest-cta invest" data-r="invest-now">Invest Now</button>'
        + '</div>';
    }
    card.innerHTML = cardHtml;
    if (hasDeal) {
      card.querySelector('[data-r="view-deal"]').addEventListener('click', function (e) {
        e.stopPropagation();
        track({ type: 'deal_cta_tap', video_id: v.id, cta: 'view_deal' });
        window.open(deal.url || 'https://ivxholding.com/invest/' + encodeURIComponent(deal.id), '_blank');
      });
      card.querySelector('[data-r="invest-now"]').addEventListener('click', function (e) {
        e.stopPropagation();
        track({ type: 'deal_cta_tap', video_id: v.id, cta: 'invest_now' });
        window.open(deal.url || 'https://ivxholding.com/invest/' + encodeURIComponent(deal.id), '_blank');
      });
    }
    slide.appendChild(card);

    /* Optional subtle property subtitle/tour label above the card */
    if (parsed.subtitle && !hasDeal) {
      var tourLabel = document.createElement('div');
      tourLabel.className = 'ivxr-meta';
      tourLabel.style.cssText = 'bottom:calc(140px + env(safe-area-inset-bottom));right:84px;left:14px;';
      tourLabel.innerHTML = '<div class="s">' + escapeHtml(parsed.subtitle) + '</div>';
      slide.appendChild(tourLabel);
    }

    if (!isLive) {
      var rail = document.createElement('div');
      rail.className = 'ivxr-rail';
      rail.innerHTML = ''
        + '<button class="ivxr-act like' + (v.viewer_liked ? ' on' : '') + '"><span class="i">' + (v.viewer_liked ? '&#10084;' : '&#9825;') + '</span><span class="c">' + fmtCount(v.like_count) + '</span></button>'
        + '<button class="ivxr-act cmt"><span class="i">&#128172;</span><span class="c">' + fmtCount(v.comment_count) + '</span></button>'
        + '<button class="ivxr-act sav' + (v.viewer_saved ? ' saved' : '') + '"><span class="i">' + (v.viewer_saved ? '&#128278;' : '&#128279;') + '</span><span class="c">' + fmtCount(v.save_count) + '</span></button>'
        + '<button class="ivxr-act shr"><span class="i">&#10148;</span><span class="c">' + fmtCount(v.share_count) + '</span></button>'
        + '<button class="ivxr-act mute" data-r="mute"><span class="i">' + (state.muted ? '&#128263;' : '&#128266;') + '</span></button>';
      slide.appendChild(rail);
      wireRail(rail, slide, v, heart);
      var railMute = rail.querySelector('[data-r="mute"]');
      railMute.addEventListener('click', function (e) {
        e.stopPropagation();
        state.muted = !state.muted;
        vid.muted = state.muted;
        railMute.querySelector('.i').innerHTML = state.muted ? '&#128263;' : '&#128266;';
      });
    }

    var prog = document.createElement('div');
    prog.className = 'ivxr-prog';
    prog.innerHTML = '<div></div>';
    slide.appendChild(prog);
    vid.addEventListener('timeupdate', function () {
      if (vid.duration > 0) prog.firstChild.style.width = (vid.currentTime / vid.duration * 100) + '%';
    });
    vid.addEventListener('ended', function () { track({ type: 'complete', video_id: v.id }); });
    var loopCount = 0;
    vid.addEventListener('seeked', function () {
      if (vid.loop && vid.currentTime < 0.3 && vid.duration > 1) {
        loopCount += 1;
        if (loopCount <= 3) track({ type: 'complete', video_id: v.id });
      }
    });

    /* tap: single = play/pause · double = like */
    var lastTap = 0;
    slide.addEventListener('click', function (e) {
      if (e.target.closest('.ivxr-rail') || e.target.closest('.ivxr-mute')) return;
      var now = Date.now();
      if (now - lastTap < 320) {
        lastTap = 0;
        doubleTapLike(slide, v, heart);
      } else {
        lastTap = now;
        setTimeout(function () {
          if (lastTap === now) {
            if (vid.paused) vid.play().catch(function () {}); else vid.pause();
          }
        }, 330);
      }
    });

    slide.__attach = function () { attachSource(vid, v.hls_url, v.video_url); };
    slide.__vid = vid;
    return slide;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- engagement wiring ---------- */
  function wireRail(rail, slide, v, heart) {
    var likeBtn = rail.querySelector('.like');
    var cmtBtn = rail.querySelector('.cmt');
    var shrBtn = rail.querySelector('.shr');
    var savBtn = rail.querySelector('.sav');
    var folBtn = rail.querySelector('.ivxr-follow');
    var rptBtn = rail.querySelector('.rpt');

    likeBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleLike(v, likeBtn, heart, false); try { if (typeof ivxTrack === 'function') ivxTrack('reel_like', { video_id: v.id }); } catch(x) {} });
    cmtBtn.addEventListener('click', function (e) { e.stopPropagation(); openComments(v, cmtBtn); try { if (typeof ivxTrack === 'function') ivxTrack('reel_comment', { video_id: v.id }); } catch(x) {} });
    savBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      try { if (typeof ivxTrack === 'function') ivxTrack('reel_save', { video_id: v.id }); } catch(x) {}
      fetch(API + '/api/projects/' + v.id + '/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guest_id: VIEWER })
      }).then(function (r) { return r.json(); }).then(function (d) {
        savBtn.classList.toggle('saved', !!d.saved);
        savBtn.querySelector('.i').innerHTML = d.saved ? '&#128278;' : '&#128279;';
        savBtn.querySelector('.c').textContent = fmtCount(d.save_count);
        toast(d.saved ? 'Saved' : 'Removed from saved');
      }).catch(function () { toast('Save failed'); });
    });
    shrBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      try { if (typeof ivxTrack === 'function') ivxTrack('reel_share', { video_id: v.id }); } catch(x) {}
      var url = 'https://ivxholding.com/?video=' + encodeURIComponent(v.id);
      var done = function (type) {
        fetch(API + '/api/projects/' + v.id + '/share', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guest_id: VIEWER, share_type: type, share_url: url })
        }).then(function (r) { return r.json(); }).then(function (d) {
          if (d && d.share_count != null) shrBtn.querySelector('.c').textContent = fmtCount(d.share_count);
        }).catch(function () {});
        track({ type: 'share', video_id: v.id });
      };
      if (navigator.share) {
        navigator.share({ title: v.title || 'IVX Property Video', url: url }).then(function () { done('social'); }).catch(function () {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(function () { toast('Link copied'); done('copy_link'); });
      }
    });
    folBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var creator = v.creator_id || 'ivx-owner';
      fetch(API + '/api/ivx/video-platform/follow', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ follower_id: VIEWER, creator_id: creator })
      }).then(function (r) { return r.json(); }).then(function (d) {
        folBtn.classList.toggle('on', !!d.following);
        folBtn.textContent = d.following ? 'Following' : 'Follow';
        toast(d.following ? 'Following creator' : 'Unfollowed');
      }).catch(function () { toast('Follow failed'); });
    });
    rptBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var reason = prompt('Report this video — reason:');
      if (!reason) return;
      fetch(API + '/api/ivx/video-platform/videos/' + v.id + '/report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reporter_id: VIEWER, reason: reason })
      }).then(function () { toast('Report submitted to moderation'); }).catch(function () { toast('Report failed'); });
    });
  }

  function toggleLike(v, likeBtn, heart, forceLike) {
    var isLiked = likeBtn.classList.contains('on');
    if (forceLike && isLiked) { burstHeart(heart); return; }
    fetch(API + '/api/projects/' + v.id + '/like', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guest_id: VIEWER })
    }).then(function (r) { return r.json(); }).then(function (d) {
      likeBtn.classList.toggle('on', !!d.liked);
      likeBtn.querySelector('.i').innerHTML = d.liked ? '&#10084;' : '&#9825;';
      likeBtn.querySelector('.c').textContent = fmtCount(d.like_count);
    }).catch(function () { toast('Like failed'); });
  }

  function burstHeart(heart) {
    heart.classList.remove('burst');
    void heart.offsetWidth;
    heart.classList.add('burst');
  }

  function doubleTapLike(slide, v, heart) {
    burstHeart(heart);
    track({ type: 'double_tap_like', video_id: v.id });
    var likeBtn = slide.querySelector('.like');
    if (likeBtn && !likeBtn.classList.contains('on')) toggleLike(v, likeBtn, heart, true);
  }

  /* ---------- comments sheet ---------- */
  var sheetVideo = null;
  var sheetCountEl = null;
  function openSheet(title, withInput) {
    el('sheetTitle').textContent = title;
    el('sheetBody').innerHTML = '';
    el('sheetInput').style.display = withInput ? 'flex' : 'none';
    sheetEl.classList.add('open');
  }
  el('sheetClose').addEventListener('click', function () { sheetEl.classList.remove('open'); sheetVideo = null; });

  function openComments(v, cmtBtn) {
    sheetVideo = v;
    sheetCountEl = cmtBtn.querySelector('.c');
    openSheet('Comments', true);
    el('sheetBody').innerHTML = '<div class="ivxr-empty">Loading…</div>';
    fetch(API + '/api/projects/' + v.id + '/comments?limit=50')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var list = (d && d.comments) || [];
        var bd = el('sheetBody');
        bd.innerHTML = list.length ? '' : '<div class="ivxr-empty">No comments yet — be the first.</div>';
        list.forEach(function (c) {
          var row = document.createElement('div');
          row.className = 'ivxr-cmt';
          row.innerHTML = '<div class="a">' + escapeHtml(c.guest_name || (c.is_owner_reply ? 'IVX Team' : 'Investor')) + '</div>'
            + '<div class="b">' + escapeHtml(c.body) + '</div>';
          bd.appendChild(row);
        });
      })
      .catch(function () { el('sheetBody').innerHTML = '<div class="ivxr-empty">Comments failed to load.</div>'; });
  }
  el('cmtSend').addEventListener('click', function () {
    var input = el('cmtText');
    var body = (input.value || '').trim();
    if (!body || !sheetVideo) return;
    var name = '';
    try { name = localStorage.getItem('ivx_guest_name') || ''; } catch (e) {}
    if (!name) {
      name = prompt('Your name for the comment:') || 'Guest';
      try { localStorage.setItem('ivx_guest_name', name); } catch (e) {}
    }
    fetch(API + '/api/projects/' + sheetVideo.id + '/comments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guest_name: name, body: body })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.success) {
        input.value = '';
        var bd = el('sheetBody');
        var empty = bd.querySelector('.ivxr-empty');
        if (empty) empty.remove();
        var row = document.createElement('div');
        row.className = 'ivxr-cmt';
        row.innerHTML = '<div class="a">' + escapeHtml(name) + '</div><div class="b">' + escapeHtml(body) + '</div>';
        bd.insertBefore(row, bd.firstChild);
        if (sheetCountEl) sheetCountEl.textContent = fmtCount((parseInt(sheetCountEl.textContent, 10) || 0) + 1);
        toast('Comment posted');
      } else {
        toast((d && d.error) || 'Comment failed');
      }
    }).catch(function () { toast('Comment failed'); });
  });

  /* ---------- stories + live ---------- */
  function loadStoriesAndLive() {
    var strip = el('stories');
    Promise.all([
      fetch(API + '/api/ivx/video-platform/stories').then(function (r) { return r.json(); }).catch(function () { return { stories: [] }; }),
      fetch(API + '/api/ivx/video-platform/live').then(function (r) { return r.json(); }).catch(function () { return { sessions: [] }; })
    ]).then(function (res) {
      var stories = (res[0] && res[0].stories) || [];
      var live = ((res[1] && res[1].sessions) || []).filter(function (s) { return s.playback_url; });
      strip.innerHTML = '';
      if (!stories.length && !live.length) { strip.style.display = 'none'; return; }
      strip.style.display = 'flex';
      live.forEach(function (s) {
        var b = document.createElement('button');
        b.className = 'ivxr-story';
        b.innerHTML = '<img src="https://ivxholding.com/favicon.ico" style="border-color:#e0245e" alt=""/><span style="color:#e0245e;font-weight:700">LIVE</span>';
        b.addEventListener('click', function () { playStory({ id: 'live-' + s.id, title: s.title, hls_url: s.playback_url, video_url: s.playback_url, orientation: 'portrait' }, true); });
        strip.appendChild(b);
      });
      stories.forEach(function (st) {
        var b = document.createElement('button');
        b.className = 'ivxr-story';
        b.innerHTML = '<img src="' + escapeHtml(st.thumbnail_url || st.poster_url || '') + '" alt=""/><span>' + escapeHtml(st.title || 'Story') + '</span>';
        b.addEventListener('click', function () { playStory(st, false); });
        strip.appendChild(b);
      });
    });
  }

  function playStory(st, isLive) {
    deactivateCurrent();
    state.storyMode = true;
    feedEl.innerHTML = '';
    state.cursor = null;
    state.done = true;
    var slide = buildSlide({
      id: st.id, title: st.title, hls_url: st.hls_url, video_url: st.video_url,
      poster_url: st.poster_url || null, thumbnail_url: st.thumbnail_url || null,
      orientation: st.orientation || 'portrait', audiences: isLive ? [] : ['story'],
      like_count: 0, comment_count: 0, share_count: 0, save_count: 0, view_count: 0
    }, isLive);
    feedEl.appendChild(slide);
    observeSlides();
    toast(isLive ? 'Watching live' : 'Playing story — pick a channel tab to return');
  }

  /* ---------- autoplay engine ---------- */
  var io = null;
  function observeSlides() {
    if (!io) {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var slide = entry.target;
          if (entry.isIntersecting && entry.intersectionRatio >= 0.8) activateSlide(slide);
          else if (slide === state.activeSlide && entry.intersectionRatio < 0.5) deactivateCurrent();
        });
      }, { root: feedEl, threshold: [0, 0.5, 0.8, 1] });
    }
    feedEl.querySelectorAll('.ivxr-slide').forEach(function (s) {
      if (!s.__observed) { s.__observed = true; io.observe(s); }
    });
    /* infinite scroll sentinel */
    var slides = feedEl.querySelectorAll('.ivxr-slide');
    if (slides.length >= 2 && !state.done) {
      var trigger = slides[slides.length - 2];
      if (!trigger.__sentinel) {
        trigger.__sentinel = true;
        var sio = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) { loadMore(); sio.disconnect(); }
          });
        }, { root: feedEl, threshold: 0.1 });
        sio.observe(trigger);
      }
    }
  }

  /** Preload the next 1–2 slides only — attach their sources so the first frames buffer. */
  function preloadUpcoming(slide) {
    var next = slide.nextElementSibling;
    var count = 0;
    while (next && count < 2) {
      if (next.__attach && next.__vid) {
        next.__vid.preload = 'metadata';
        next.__attach();
      }
      next = next.nextElementSibling;
      count += 1;
    }
  }

  function activateSlide(slide) {
    if (state.activeSlide === slide) return;
    deactivateCurrent();
    state.activeSlide = slide;
    state.activeSince = Date.now();
    if (slide.__attach) slide.__attach();
    preloadUpcoming(slide);
    var vid = slide.__vid;
    if (vid) {
      vid.muted = state.muted;
      vid.play().catch(function () { vid.muted = true; state.muted = true; vid.play().catch(function () {}); });
    }
    var v = slide.__video;
    if (v && v.id && String(v.id).indexOf('live-') !== 0) {
      state.viewTimer = setTimeout(function () { track({ type: 'view', video_id: v.id }); }, 1500);
    }
  }

  function deactivateCurrent() {
    var slide = state.activeSlide;
    if (!slide) return;
    clearTimeout(state.viewTimer);
    var v = slide.__video;
    if (v && v.id && String(v.id).indexOf('live-') !== 0 && state.activeSince) {
      var ms = Date.now() - state.activeSince;
      if (ms > 500) track({ type: 'watch', video_id: v.id, watch_ms: ms });
    }
    if (slide.__vid) slide.__vid.pause();
    state.activeSlide = null;
    state.activeSince = 0;
  }

  /* ---------- upload ---------- */
  el('upload').addEventListener('click', function () { el('file').click(); });
  el('file').addEventListener('change', function () {
    var file = el('file').files && el('file').files[0];
    if (!file) return;
    var title = prompt('Video title:', file.name.replace(/\.[^.]+$/, '')) || file.name;
    openSheet('Uploading video', false);
    var bd = el('sheetBody');
    bd.innerHTML = '<div class="ivxr-up"><div>' + escapeHtml(file.name) + ' (' + (file.size / 1024 / 1024).toFixed(1) + ' MB)</div>'
      + '<div class="bar"><div data-r="upbar"></div></div><div data-r="upstat">Uploading… 0%</div></div>';
    var form = new FormData();
    form.append('file', file);
    form.append('title', title);
    form.append('userId', VIEWER);
    /* Upload with automatic resume: up to 3 attempts on network failure. */
    var attempt = 0;
    function sendUpload() {
      attempt += 1;
      var xhr = new XMLHttpRequest();
      xhr.open('POST', API + '/api/ivx/video-pipeline/upload');
      xhr.upload.onprogress = function (e) {
        if (e.lengthComputable) {
          var pct = Math.round(e.loaded / e.total * 100);
          var bar = root.querySelector('[data-r="upbar"]');
          var stat = root.querySelector('[data-r="upstat"]');
          if (bar) bar.style.width = pct + '%';
          if (stat) stat.textContent = 'Uploading… ' + pct + '%' + (attempt > 1 ? ' (attempt ' + attempt + ')' : '');
        }
      };
      xhr.onload = function () {
        var stat = root.querySelector('[data-r="upstat"]');
        try {
          var res = JSON.parse(xhr.responseText);
          if (xhr.status === 201 && res.videoId) {
            if (stat) stat.textContent = 'Processing video (transcoding to adaptive HLS)…';
            var metaBody = state.channel
              ? { audiences: [state.channel], creator_id: VIEWER }
              : { creator_id: VIEWER };
            fetch(API + '/api/ivx/video-platform/videos/' + res.videoId + '/meta', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(metaBody)
            }).catch(function () {});
            pollUpload(res.videoId, stat);
          } else {
            if (stat) stat.textContent = 'Upload failed: ' + (res.error || xhr.status);
          }
        } catch (e) {
          if (stat) stat.textContent = 'Upload failed (' + xhr.status + ')';
        }
      };
      xhr.onerror = function () {
        var stat = root.querySelector('[data-r="upstat"]');
        if (attempt < 3) {
          if (stat) stat.textContent = 'Network error — resuming upload (attempt ' + (attempt + 1) + ' of 3)…';
          setTimeout(sendUpload, 1500 * attempt);
        } else if (stat) {
          stat.textContent = 'Upload failed after 3 attempts — check your connection and try again.';
        }
      };
      xhr.send(form);
    }
    sendUpload();
    el('file').value = '';
  });

  function pollUpload(videoId, stat) {
    var tries = 0;
    var t = setInterval(function () {
      tries += 1;
      if (tries > 150) { clearInterval(t); return; }
      fetch(API + '/api/ivx/video-pipeline/' + videoId)
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var v = d && d.video;
          if (!v) return;
          if (v.status === 'ready') {
            clearInterval(t);
            if (stat) stat.textContent = 'Ready — live in the feed with adaptive streaming.';
            toast('Video is live');
            resetFeed();
            loadMore();
          } else if (v.status === 'failed') {
            clearInterval(t);
            if (stat) stat.textContent = 'Processing failed: ' + (v.error || 'unknown') + ' — retry from owner console.';
          } else if (stat) {
            stat.textContent = 'Processing (' + v.status + ')… renditions: 720p / 480p / 360p';
          }
        }).catch(function () {});
    }, 4000);
  }

  /* ---------- creator dashboard ---------- */
  el('dash').addEventListener('click', function () {
    openSheet('Creator Dashboard', false);
    var bd = el('sheetBody');
    bd.innerHTML = '<div class="ivxr-empty">Loading analytics…</div>';
    fetch(API + '/api/ivx/video-platform/creator/' + encodeURIComponent(VIEWER) + '/dashboard')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var html = '<div class="ivxr-kpis">'
          + '<div class="ivxr-kpi"><div class="v">' + fmtCount(d.total_views) + '</div><div class="l">Views</div></div>'
          + '<div class="ivxr-kpi"><div class="v">' + fmtCount(d.follower_count) + '</div><div class="l">Followers</div></div>'
          + '<div class="ivxr-kpi"><div class="v">' + (d.total_watch_hours || 0) + 'h</div><div class="l">Watch time</div></div>'
          + '<div class="ivxr-kpi"><div class="v">' + fmtCount(d.video_count) + '</div><div class="l">Videos</div></div>'
          + '</div>';
        if (d.videos && d.videos.length) {
          d.videos.forEach(function (v) {
            html += '<div class="ivxr-dashrow"><span>' + escapeHtml(v.title || v.id.slice(0, 8)) + '</span>'
              + '<span>' + fmtCount(v.views) + ' views · ' + fmtCount(v.likes) + ' ♥ · ' + fmtCount(v.completions) + ' completes</span></div>';
          });
        } else {
          html += '<div class="ivxr-empty">Upload videos with &#65291; to see per-video analytics here.</div>';
        }
        bd.innerHTML = html;
      })
      .catch(function () { bd.innerHTML = '<div class="ivxr-empty">Dashboard failed to load.</div>'; });
  });

  /* ---------- open / close ---------- */
  function openReels() {
    root.classList.add('open');
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    track({ type: 'profile' });
    if (!feedEl.children.length || state.storyMode) { resetFeed(); loadMore(); }
    loadStoriesAndLive();
  }
  function closeReels() {
    deactivateCurrent();
    flushEvents(false);
    root.classList.remove('open');
    sheetEl.classList.remove('open');
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }
  launch.addEventListener('click', openReels);
  el('close').addEventListener('click', closeReels);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && root.classList.contains('open')) closeReels(); });

  /* deep link: ?video=<id> opens reels directly */
  try {
    var qs = new URLSearchParams(location.search);
    if (qs.get('video')) setTimeout(openReels, 600);
  } catch (e) {}
})();
