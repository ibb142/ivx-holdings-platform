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
    + '.ivx-hf-video{grid-column:1/-1;position:relative;background:#000;border-radius:18px;overflow:hidden;'
    + 'width:100%;max-width:480px;margin:0 auto;aspect-ratio:9/16;min-height:560px;max-height:88vh;display:flex;flex-direction:column}'
    + '.ivx-hf-media{position:absolute;inset:0;background:#000;overflow:hidden}'
    + '.ivx-hf-media img,.ivx-hf-media video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}'
    + '.ivx-hf-gradient{position:absolute;left:0;right:0;bottom:0;height:320px;'
    + 'background:linear-gradient(to top,rgba(0,0,0,.82),rgba(0,0,0,.55),transparent);z-index:2;pointer-events:none}'
    + '.ivx-hf-tag{position:absolute;top:12px;left:12px;z-index:5;background:#FFD700;color:#000;border-radius:5px;'
    + 'padding:3px 8px;font:800 10px/1 -apple-system,Segoe UI,sans-serif;text-transform:uppercase;letter-spacing:.4px}'
    + '.ivx-hf-mute{position:absolute;top:12px;right:12px;z-index:5;background:rgba(0,0,0,.35);color:#fff;border:none;'
    + 'border-radius:50%;width:38px;height:38px;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center}'
    + '.ivx-hf-rail{position:absolute;right:10px;bottom:96px;z-index:5;display:flex;flex-direction:column;gap:16px;align-items:center}'
    + '.ivx-hf-act{background:none;border:none;color:#fff;cursor:pointer;text-align:center;padding:0;'
    + 'filter:drop-shadow(0 1px 3px rgba(0,0,0,.6))}'
    + '.ivx-hf-act .ic{width:44px;height:44px;border-radius:50%;background:rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center}'
    + '.ivx-hf-act .i{font-size:24px;line-height:1;display:block}'
    + '.ivx-hf-act .c{font:700 11px/1 -apple-system,sans-serif;margin-top:3px;display:block}'
    + '.ivx-hf-act.on .ic{color:#e0245e}'
    + '.ivx-hf-act.saved .ic{color:#E6C200}'
    + '.ivx-hf-info{position:absolute;left:14px;right:84px;bottom:26px;z-index:5;color:#fff;pointer-events:none}'
    + '.ivx-hf-badges{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}'
    + '.ivx-hf-badge{display:inline-block;background:#FFD700;color:#000;border-radius:5px;padding:3px 8px;'
    + 'font:800 10px/1 -apple-system,sans-serif;text-transform:uppercase;letter-spacing:.4px}'
    + '.ivx-hf-badge.active{background:rgba(0,0,0,.55);border:1px solid #FFD700;color:#FFD700}'
    + '.ivx-hf-name{font:800 22px/1.2 -apple-system,Segoe UI,sans-serif;text-shadow:0 1px 4px rgba(0,0,0,.7);margin-bottom:2px}'
    + '.ivx-hf-loc{font:600 13px/1.3 -apple-system,sans-serif;color:rgba(255,255,255,.85);'
    + 'text-shadow:0 1px 4px rgba(0,0,0,.7);margin-top:2px}'
    + '.ivx-hf-subtitle{font:600 15px/1.3 -apple-system,sans-serif;color:rgba(255,255,255,.9);'
    + 'text-shadow:0 1px 4px rgba(0,0,0,.7);margin-top:2px}'
    + '.ivx-hf-stats{display:flex;gap:22px;margin-top:8px;flex-wrap:wrap}'
    + '.ivx-hf-stat{text-align:center}'
    + '.ivx-hf-stat .v{font:800 20px/1 -apple-system,sans-serif;color:#FFD700}'
    + '.ivx-hf-stat .l{color:rgba(255,255,255,.75);font:600 10px/1 -apple-system,sans-serif;text-transform:uppercase;margin-top:4px}'
    + '.ivx-hf-options{display:flex;gap:14px;margin-top:10px}'
    + '.ivx-hf-opt{display:flex;flex-direction:column;align-items:center;gap:4px}'
    + '.ivx-hf-opt .circ{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;'
    + 'background:rgba(0,0,0,.35);border:1.5px solid rgba(255,255,255,.25)}'
    + '.ivx-hf-opt .circ.yellow{border-color:#FFD700;color:#FFD700}'
    + '.ivx-hf-opt .circ.blue{border-color:#4A90D9;color:#4A90D9}'
    + '.ivx-hf-opt .circ.green{border-color:#3CCF4E;color:#3CCF4E}'
    + '.ivx-hf-opt .lab{font:600 10px/1 -apple-system,sans-serif;color:#fff}'
    + '.ivx-hf-btns{display:flex;gap:10px;margin-top:14px;pointer-events:auto}'
    + '.ivx-hf-btns a{flex:1;text-align:center;border-radius:999px;padding:13px 0;font:800 15px/1 -apple-system,Segoe UI,sans-serif;'
    + 'text-decoration:none;cursor:pointer}'
    + '.ivx-hf-view{background:rgba(0,0,0,.45);color:#FFD700;border:2px solid #FFD700}'
    + '.ivx-hf-invest{background:#FFD700;color:#000}';
  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  /* SVG icons for the action rail and option circles */
  var ICONS = {
    heart: '&#9825;',
    heartFilled: '&#10084;',
    comment: '&#128172;',
    bookmark: '&#128279;',
    bookmarkFilled: '&#128278;',
    share: '&#10148;',
    mute: '&#128263;',
    unmute: '&#128266;',
    hex: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>',
    users: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>',
    home: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>'
  };

  /* ---------- featured project video card ---------- */
  function buildVideoCard(v) {
    var deal = v.deal || {};
    var card = document.createElement('div');
    card.className = 'ivx-hf-video';
    card.setAttribute('data-ivx-home-feed-video', v.id);

    var poster = v.poster_url || v.thumbnail_url || v.preview_blur_url || '';
    var dealUrl = deal.url || 'https://ivxholding.com/?deal=' + encodeURIComponent(deal.id || v.id) + '#deals';
    var title = deal.name || v.title || 'IVX Project';
    var location = deal.city || '';
    var roi = parseMetric(deal.expected_roi);
    var minInvest = parseMetric(deal.min_investment);
    var price = parseMetric(deal.price);
    var minOwnership = (minInvest && price && price > 0) ? ((minInvest / price) * 100).toFixed(4) + '%' : null;
    var dealType = (deal.deal_type || '').toLowerCase();
    var isActive = (deal.status || v.status || 'published') === 'published';

    var tokenized = { icon: ICONS.hex, label: 'Tokenized', cls: 'yellow' };
    var jvDeals = { icon: ICONS.users, label: 'JV Deal', cls: 'blue' };
    var buyers = { icon: ICONS.home, label: 'Buyer', cls: 'green' };
    var options;
    switch (dealType) {
      case 'jv': case 'equity_split': case 'hybrid': options = [tokenized, jvDeals, buyers]; break;
      case 'development': case 'new_construction': case 'rehab_construction': options = [jvDeals, tokenized, buyers]; break;
      case 'profit_sharing': options = [tokenized, buyers, jvDeals]; break;
      default: options = [tokenized, jvDeals, buyers];
    }

    var statsHtml = '';
    if (price) statsHtml += '<div class="ivx-hf-stat"><div class="v">' + money(price) + '</div><div class="l">Investment</div></div>';
    if (roi) statsHtml += '<div class="ivx-hf-stat"><div class="v">' + formatRoi(roi) + '</div><div class="l">ROI</div></div>';
    if (minInvest) statsHtml += '<div class="ivx-hf-stat"><div class="v">' + money(minInvest) + '</div><div class="l">Minimum</div></div>';
    if (!statsHtml && minOwnership) statsHtml += '<div class="ivx-hf-stat"><div class="v">' + esc(minOwnership) + '</div><div class="l">Min Ownership</div></div>';

    var optionsHtml = options.map(function (opt) {
      return '<div class="ivx-hf-opt"><div class="circ ' + opt.cls + '">' + opt.icon + '</div><div class="lab">' + esc(opt.label) + '</div></div>';
    }).join('');

    var hasDeal = !!(deal.id || v.id);
    var ctaHtml = '';
    if (hasDeal) {
      ctaHtml = '<div class="ivx-hf-btns">'
        + '<a class="ivx-hf-view" href="' + esc(dealUrl) + '">View Deal</a>'
        + '<a class="ivx-hf-invest" href="' + esc(dealUrl) + '">Invest Now</a>'
        + '</div>';
    }

    var badgesHtml = '';
    if (hasDeal) badgesHtml += '<span class="ivx-hf-badge">Investment</span>';
    if (isActive) badgesHtml += '<span class="ivx-hf-badge active">Active</span>';

    card.innerHTML = ''
      + '<div class="ivx-hf-media">'
      + '  <span class="ivx-hf-tag">Featured Project Video</span>'
      + (poster ? '<img src="' + esc(poster) + '" alt="' + esc(title) + '" loading="lazy"/>' : '')
      + '  <video playsinline muted loop preload="none"' + (poster ? ' poster="' + esc(poster) + '"' : '') + ' style="opacity:0"></video>'
      + '  <button class="ivx-hf-mute" aria-label="Unmute">' + ICONS.mute + '</button>'
      + '  <div class="ivx-hf-gradient"></div>'
      + '</div>'
      + '<div class="ivx-hf-rail">'
      + '  <button class="ivx-hf-act like' + (v.viewer_liked ? ' on' : '') + '"><span class="ic">' + (v.viewer_liked ? ICONS.heartFilled : ICONS.heart) + '</span><span class="c">' + fmt(v.like_count) + '</span></button>'
      + '  <button class="ivx-hf-act cmt"><span class="ic">' + ICONS.comment + '</span><span class="c">' + fmt(v.comment_count) + '</span></button>'
      + '  <button class="ivx-hf-act sav' + (v.viewer_saved ? ' saved' : '') + '"><span class="ic">' + (v.viewer_saved ? ICONS.bookmarkFilled : ICONS.bookmark) + '</span><span class="c">' + fmt(v.save_count) + '</span></button>'
      + '  <button class="ivx-hf-act shr"><span class="ic">' + ICONS.share + '</span><span class="c">' + fmt(v.share_count) + '</span></button>'
      + '</div>'
      + '<div class="ivx-hf-info">'
      + (badgesHtml ? '<div class="ivx-hf-badges">' + badgesHtml + '</div>' : '')
      + '  <div class="ivx-hf-name">' + esc(title) + '</div>'
      + (location ? '<div class="ivx-hf-loc">&#128205; ' + esc(location) + '</div>' : '')
      + (statsHtml ? '<div class="ivx-hf-stats">' + statsHtml + '</div>' : '')
      + (optionsHtml ? '<div class="ivx-hf-options">' + optionsHtml + '</div>' : '')
      + ctaHtml
      + '</div>';

    var vid = card.querySelector('video');
    var img = card.querySelector('.ivx-hf-media img');
    var muteBtn = card.querySelector('.ivx-hf-mute');
    var likeBtn = card.querySelector('.ivx-hf-act.like');
    var saveBtn = card.querySelector('.ivx-hf-act.sav');
    var shareBtn = card.querySelector('.ivx-hf-act.shr');

    muteBtn.addEventListener('click', function () {
      vid.muted = !vid.muted;
      muteBtn.innerHTML = vid.muted ? ICONS.mute : ICONS.unmute;
    });
    likeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleLike(v, likeBtn);
    });
    saveBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleSave(v, saveBtn);
    });
    shareBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      shareVideo(v, shareBtn);
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

  function fmt(n) {
    n = Number(n) || 0;
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }

  function toggleLike(v, btn) {
    fetch('https://api.ivxholding.com/api/projects/' + encodeURIComponent(v.id) + '/like', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guest_id: localStorage.getItem('ivx_viewer_id') || 'guest-anon' })
    }).then(function (r) { return r.json(); }).then(function (d) {
      btn.classList.toggle('on', !!d.liked);
      btn.querySelector('.ic').innerHTML = d.liked ? ICONS.heartFilled : ICONS.heart;
      btn.querySelector('.c').textContent = fmt(d.like_count);
    }).catch(function () {});
  }

  function toggleSave(v, btn) {
    fetch('https://api.ivxholding.com/api/projects/' + encodeURIComponent(v.id) + '/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guest_id: localStorage.getItem('ivx_viewer_id') || 'guest-anon' })
    }).then(function (r) { return r.json(); }).then(function (d) {
      btn.classList.toggle('saved', !!d.saved);
      btn.querySelector('.ic').innerHTML = d.saved ? ICONS.bookmarkFilled : ICONS.bookmark;
      btn.querySelector('.c').textContent = fmt(d.save_count);
    }).catch(function () {});
  }

  function shareVideo(v) {
    var url = 'https://ivxholding.com/?video=' + encodeURIComponent(v.id);
    if (navigator.share) {
      navigator.share({ title: v.title || 'IVX Property Video', url: url }).catch(function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(url).catch(function () {});
    }
    fetch('https://api.ivxholding.com/api/projects/' + encodeURIComponent(v.id) + '/share', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guest_id: localStorage.getItem('ivx_viewer_id') || 'guest-anon', share_type: 'social', share_url: url })
    }).catch(function () {});
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
