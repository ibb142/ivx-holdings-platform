/*
 * IVX Investor-First Home Feed — ivxholding.com
 *
 * Enforces the CANONICAL home layout from the single source of truth
 * (GET /api/ivx/video-platform/home-feed) — the exact same sequence the
 * Android and iOS apps render:
 *
 *   Featured Deal 1–3 → 1 Featured Project Video → Deal 4–6 → 1 video → repeat
 *
 * Behaviour:
 *   • Reorders the rendered deal cards in #properties-grid to the canonical order.
 *   • Inserts exactly ONE featured project video card after every 3 deals.
 *   • Every video card is attached to a real project (name, city, phase,
 *     investment, ROI, minimum, progress %, View Deal + Invest Now).
 *   • Performance: poster image loads first; the video source attaches only
 *     when the card scrolls into view; only the next upcoming video preloads.
 *   • Admin publish (deal/video meta) updates this page automatically on the
 *     next load — no separate configuration.
 */
(function () {
  'use strict';
  if (window.__ivxHomeFeedLoaded) return;
  window.__ivxHomeFeedLoaded = true;

  var API_CANDIDATES = ['https://api.ivxholding.com', 'https://ivx-holdings-platform.onrender.com'];
  var HLS_CDN = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js';

  var homeFeed = null;      /* canonical blocks from the backend */
  var applying = false;     /* guard against observer feedback loops */

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    n = Number(n) || 0;
    if (n >= 1000000) return '$' + (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1) + 'M';
    if (n >= 1000) return '$' + (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'K';
    return '$' + Math.round(n);
  }

  function fetchHomeFeed(i) {
    i = i || 0;
    if (i >= API_CANDIDATES.length) return Promise.reject(new Error('all API hosts failed'));
    return fetch(API_CANDIDATES[i] + '/api/ivx/video-platform/home-feed?limit=60')
      .then(function (r) {
        var ct = (r.headers.get('content-type') || '').toLowerCase();
        if (!r.ok || ct.indexOf('json') === -1) throw new Error('bad response');
        return r.json();
      })
      .catch(function () { return fetchHomeFeed(i + 1); });
  }

  /* ---------- lazy HLS ---------- */
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
        var h = new window.Hls({ capLevelToPlayerSize: true, maxBufferLength: 15 });
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
    + '.ivx-hf-video{grid-column:1/-1;background:#141414;border:1px solid rgba(255,215,0,.25);border-radius:16px;'
    + 'overflow:hidden;display:flex;flex-direction:column}'
    + '.ivx-hf-media{position:relative;background:#000;aspect-ratio:16/9;max-height:420px;overflow:hidden}'
    + '.ivx-hf-media img,.ivx-hf-media video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}'
    + '.ivx-hf-tag{position:absolute;top:12px;left:12px;z-index:3;background:#FFD700;color:#000;border-radius:6px;'
    + 'padding:4px 10px;font:800 11px/1 -apple-system,Segoe UI,sans-serif;text-transform:uppercase;letter-spacing:.5px}'
    + '.ivx-hf-mute{position:absolute;bottom:12px;right:12px;z-index:3;background:rgba(0,0,0,.6);color:#fff;border:none;'
    + 'border-radius:50%;width:36px;height:36px;font-size:16px;cursor:pointer}'
    + '.ivx-hf-body{padding:16px;color:#fff;font-family:-apple-system,Segoe UI,sans-serif}'
    + '.ivx-hf-name{font-weight:800;font-size:17px;margin-bottom:2px}'
    + '.ivx-hf-loc{color:#9a9a9a;font-size:12.5px;margin-bottom:4px}'
    + '.ivx-hf-phase{display:inline-block;color:#00C48C;background:rgba(34,197,94,.12);border-radius:5px;'
    + 'padding:3px 8px;font:700 10.5px/1.2 -apple-system,sans-serif;text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px}'
    + '.ivx-hf-stats{display:flex;gap:0;background:#1E1E1E;border-radius:10px;padding:10px 4px;margin-bottom:10px}'
    + '.ivx-hf-stat{flex:1;text-align:center}'
    + '.ivx-hf-stat .v{font-weight:800;font-size:14px}'
    + '.ivx-hf-stat .l{color:#7a7a7a;font-size:9.5px;font-weight:600;text-transform:uppercase;margin-top:2px}'
    + '.ivx-hf-prog{display:flex;align-items:center;gap:8px;margin-bottom:12px}'
    + '.ivx-hf-prog .track{flex:1;height:6px;border-radius:3px;background:#1E1E1E;overflow:hidden}'
    + '.ivx-hf-prog .fill{height:100%;border-radius:3px;background:#FFD700}'
    + '.ivx-hf-prog .pct{color:#9a9a9a;font-size:11.5px;font-weight:700}'
    + '.ivx-hf-btns{display:flex;gap:8px}'
    + '.ivx-hf-btns a{flex:1;text-align:center;border-radius:10px;padding:12px 0;font:700 14px/1 -apple-system,Segoe UI,sans-serif;'
    + 'text-decoration:none;cursor:pointer}'
    + '.ivx-hf-view{background:#1E1E1E;color:#fff;border:1px solid rgba(255,255,255,.12)}'
    + '.ivx-hf-invest{background:#FFD700;color:#000}';
  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  /* ---------- featured project video card ---------- */
  function buildVideoCard(v) {
    var deal = v.deal || {};
    var card = document.createElement('div');
    card.className = 'ivx-hf-video';
    card.setAttribute('data-ivx-home-feed-video', v.id);

    var poster = v.poster_url || v.thumbnail_url || v.preview_blur_url || '';
    var statBits = '';
    if (deal.investment_amount) statBits += '<div class="ivx-hf-stat"><div class="v">' + money(deal.investment_amount) + '</div><div class="l">Investment</div></div>';
    if (deal.expected_roi) statBits += '<div class="ivx-hf-stat"><div class="v" style="color:#00C48C">' + esc(deal.expected_roi) + '%</div><div class="l">ROI</div></div>';
    if (deal.min_investment) statBits += '<div class="ivx-hf-stat"><div class="v">' + money(deal.min_investment) + '</div><div class="l">Minimum</div></div>';
    var progressRow = '';
    if (deal.progress_percent != null) {
      var pct = Math.min(100, Math.max(0, Number(deal.progress_percent) || 0));
      progressRow = '<div class="ivx-hf-prog"><div class="track"><div class="fill" style="width:' + pct + '%"></div></div>'
        + '<span class="pct">' + pct + '%</span></div>';
    }
    var dealUrl = deal.url || 'https://ivxholding.com/#deals';

    card.innerHTML = ''
      + '<div class="ivx-hf-media">'
      + '  <span class="ivx-hf-tag">Featured Project Video</span>'
      + (poster ? '<img src="' + esc(poster) + '" alt="' + esc(deal.name || v.title || '') + '" loading="lazy"/>' : '')
      + '  <video playsinline muted loop preload="none"' + (poster ? ' poster="' + esc(poster) + '"' : '') + ' style="opacity:0"></video>'
      + '  <button class="ivx-hf-mute" aria-label="Unmute">&#128263;</button>'
      + '</div>'
      + '<div class="ivx-hf-body">'
      + '  <div class="ivx-hf-name">' + esc(deal.name || v.title || 'IVX Project') + '</div>'
      + (deal.city ? '<div class="ivx-hf-loc">&#128205; ' + esc(deal.city) + '</div>' : '')
      + (deal.phase ? '<span class="ivx-hf-phase">' + esc(deal.phase) + '</span>' : '')
      + (statBits ? '<div class="ivx-hf-stats">' + statBits + '</div>' : '')
      + progressRow
      + '  <div class="ivx-hf-btns">'
      + '    <a class="ivx-hf-view" href="' + esc(dealUrl) + '">View Deal</a>'
      + '    <a class="ivx-hf-invest" href="https://chat.ivxholding.com/investor">Invest Now</a>'
      + '  </div>'
      + '</div>';

    var vid = card.querySelector('video');
    var img = card.querySelector('.ivx-hf-media img');
    var muteBtn = card.querySelector('.ivx-hf-mute');
    muteBtn.addEventListener('click', function () {
      vid.muted = !vid.muted;
      muteBtn.innerHTML = vid.muted ? '&#128263;' : '&#128266;';
    });

    /* Lazy playback: attach the source ONLY when visible; images load first. */
    card.__ivxActivate = function () {
      attachSource(vid, v.hls_url, v.video_url);
      vid.play().then(function () {
        vid.style.opacity = '1';
        if (img) img.style.opacity = '0';
      }).catch(function () {});
    };
    card.__ivxDeactivate = function () { try { vid.pause(); } catch (e) {} };
    card.__ivxPreload = function () {
      /* preload the NEXT featured video only — metadata, no full download */
      if (!vid.__ivxAttached) { vid.preload = 'metadata'; attachSource(vid, v.hls_url, v.video_url); }
    };
    return card;
  }

  var videoIO = null;
  function observeVideoCards(grid) {
    if (!videoIO) {
      videoIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var card = entry.target;
          if (entry.isIntersecting && entry.intersectionRatio >= 0.35) {
            if (card.__ivxActivate) card.__ivxActivate();
            /* preload only the next upcoming video card */
            var all = Array.prototype.slice.call(document.querySelectorAll('[data-ivx-home-feed-video]'));
            var idx = all.indexOf(card);
            if (idx >= 0 && all[idx + 1] && all[idx + 1].__ivxPreload) all[idx + 1].__ivxPreload();
          } else if (!entry.isIntersecting && card.__ivxDeactivate) {
            card.__ivxDeactivate();
          }
        });
      }, { threshold: [0, 0.35] });
    }
    grid.querySelectorAll('[data-ivx-home-feed-video]').forEach(function (card) {
      if (!card.__ivxObserved) { card.__ivxObserved = true; videoIO.observe(card); }
    });
  }

  /* ---------- canonical order + interleave ---------- */
  function cardDealId(card) {
    var slider = card.querySelector('[id^="slider-"]');
    return slider ? slider.id.slice('slider-'.length) : null;
  }

  function applyHomeFeedLayout() {
    if (!homeFeed || applying) return;
    var grid = document.getElementById('properties-grid');
    if (!grid) return;
    var cards = Array.prototype.slice.call(grid.querySelectorAll('.live-deal-card'))
      .filter(function (c) { return !c.hasAttribute('data-ivx-home-feed-video'); });
    if (cards.length === 0) return;

    var byId = {};
    cards.forEach(function (c) {
      var id = cardDealId(c);
      if (id) byId[id] = c;
    });

    applying = true;
    try {
      /* remove previously injected video cards before re-applying */
      grid.querySelectorAll('[data-ivx-home-feed-video]').forEach(function (n) { n.remove(); });

      var frag = document.createDocumentFragment();
      var placed = {};
      var placedCount = 0;
      homeFeed.blocks.forEach(function (block) {
        if (block.type === 'deal' && block.deal && byId[block.deal.id]) {
          frag.appendChild(byId[block.deal.id]);
          placed[block.deal.id] = true;
          placedCount += 1;
        } else if (block.type === 'video' && block.video) {
          frag.appendChild(buildVideoCard(block.video));
        }
      });
      /* keep any locally-rendered cards the canonical feed doesn't know about */
      cards.forEach(function (c) {
        var id = cardDealId(c);
        if (!id || !placed[id]) frag.appendChild(c);
      });
      grid.appendChild(frag);
      observeVideoCards(grid);
      console.log('[IVX HomeFeed] Applied canonical layout — ' + placedCount + ' deals ordered, '
        + grid.querySelectorAll('[data-ivx-home-feed-video]').length + ' featured project videos interleaved (pattern '
        + (homeFeed.pattern || 'n/a') + ')');
    } finally {
      /* release the guard on the next tick so our own mutations are ignored */
      setTimeout(function () { applying = false; }, 0);
    }
  }

  /* ---------- boot ---------- */
  function boot() {
    fetchHomeFeed(0)
      .then(function (data) {
        if (!data || !Array.isArray(data.blocks)) return;
        homeFeed = data;
        applyHomeFeedLayout();
        var grid = document.getElementById('properties-grid');
        if (!grid) return;

        // Robust race-condition fix: cards may be rendered AFTER the home feed API
        // returns (main landing script is async). Poll for up to 6s, then observe.
        var pollAttempts = 0;
        var maxPoll = 24;
        var pollTimer = null;
        function pollForCards() {
          if (!grid || applying) return;
          var cards = grid.querySelectorAll('.live-deal-card:not([data-ivx-home-feed-video])');
          if (cards.length > 0) {
            applyHomeFeedLayout();
            if (pollTimer) clearInterval(pollTimer);
            return;
          }
          pollAttempts += 1;
          if (pollAttempts >= maxPoll && pollTimer) clearInterval(pollTimer);
        }
        pollTimer = setInterval(pollForCards, 250);
        setTimeout(function () { if (pollTimer) clearInterval(pollTimer); }, 6500);

        var mo = new MutationObserver(function () {
          if (applying) return;
          clearTimeout(boot.__t);
          boot.__t = setTimeout(applyHomeFeedLayout, 250);
        });
        mo.observe(grid, { childList: true });
      })
      .catch(function (err) {
        console.warn('[IVX HomeFeed] canonical feed unavailable — keeping local order:', err && err.message);
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
