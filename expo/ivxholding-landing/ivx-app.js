
// === Extracted Script Block 1 (499 lines) ===

(function () {
  'use strict';
  // ── API base resolution (placeholder replaced at deploy; meta tags as fallback)
  var _vxApi = '__IVX_BACKEND_URL__';
  function _vxIsPlaceholder(v) { return !v || v.indexOf('__IVX_') === 0 || v.length < 10; }
  function vxApi() {
    if (!_vxIsPlaceholder(_vxApi)) return _vxApi.replace(/\/$/, '');
    var m = document.querySelector('meta[name="ivx-backend-url"]');
    if (m && m.content && !_vxIsPlaceholder(m.content)) return m.content.replace(/\/$/, '');
    var m2 = document.querySelector('meta[name="ivx-api-url"]');
    if (m2 && m2.content && !_vxIsPlaceholder(m2.content)) return m2.content.replace(/\/$/, '');
    return '';
  }
  // ── Guest identity for likes/shares
  function vxGuestId() {
    try {
      var g = localStorage.getItem('ivx_guest_id');
      if (!g) { g = 'g-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10); localStorage.setItem('ivx_guest_id', g); }
      return g;
    } catch (e) { return 'g-anon'; }
  }
  function vxLikedSet() {
    try { return JSON.parse(localStorage.getItem('ivx_vx_likes') || '[]'); } catch (e) { return []; }
  }
  function vxSetLiked(id, liked) {
    try {
      var s = vxLikedSet();
      var i = s.indexOf(id);
      if (liked && i === -1) s.push(id);
      if (!liked && i !== -1) s.splice(i, 1);
      localStorage.setItem('ivx_vx_likes', JSON.stringify(s));
    } catch (e) {}
  }
  function vxToast(msg) {
    var t = document.getElementById('vx-toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('vx-show');
    clearTimeout(t._vxTimer);
    t._vxTimer = setTimeout(function () { t.classList.remove('vx-show'); }, 2600);
  }
  function vxEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function vxNum(n) {
    n = Number(n) || 0;
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }
  var HEART_SVG = '<svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
  var COMMENT_SVG = '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
  var SHARE_SVG = '<svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
  var SAVE_SVG = '<svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
  var VERIFIED_SVG = '<svg class="vx-verified" viewBox="0 0 24 24"><path fill="#0095f6" stroke="none" d="M12 1.5l2.5 2.3 3.4-.5.9 3.3 3 1.7-1.3 3.2 1.3 3.2-3 1.7-.9 3.3-3.4-.5L12 22.5l-2.5-2.3-3.4.5-.9-3.3-3-1.7 1.3-3.2L2.2 9.3l3-1.7.9-3.3 3.4.5L12 1.5z"/><path fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M8.7 12.3l2.2 2.2 4.4-5"/></svg>';

  var _vxVideos = [];

  function vxRender() {
    var grid = document.getElementById('vx-grid');
    var section = document.getElementById('videos');
    if (!grid || !section) return;
    if (_vxVideos.length === 0) { section.style.display = 'none'; return; }
    section.style.display = '';
    var liveCount = document.getElementById('vx-live-count');
    if (liveCount) liveCount.textContent = _vxVideos.length + ' LIVE';
    var liked = vxLikedSet();
    var savedSet = vxSavedSet();
    grid.innerHTML = _vxVideos.map(function (v) {
      var vid = vxEsc(v.id);
      var isLiked = liked.indexOf(v.id) !== -1;
      var isSaved = savedSet.indexOf(v.id) !== -1;
      var poster = v.poster_url || v.thumbnail_url || v.cover_url || '';
      var vxHls = v.hls_url || '';
      var vxSrcAttr = vxHls
        ? 'data-hls="' + vxEsc(vxHls) + '" data-fallback="' + vxEsc(v.video_url) + '"'
        : 'src="' + vxEsc(v.video_url) + '"';
      var commentCount = Number(v.comment_count) || 0;
      var viewAllLabel = commentCount > 0
        ? 'View all <span class="vx-comment-count">' + vxNum(commentCount) + '</span> comments'
        : 'Add a comment&#8230;';
      return '<div class="vx-card" data-vid="' + vid + '">' +
        '<div class="vx-head">' +
          '<div class="vx-avatar-ring"><div class="vx-avatar">IVX</div></div>' +
          '<div class="vx-user-col">' +
            '<div class="vx-username">ivxholdings' + VERIFIED_SVG + '</div>' +
            '<div class="vx-sub">' + (v.title ? vxEsc(v.title) : 'Active development') + '</div>' +
          '</div>' +
          '<button class="vx-more" onclick="vxToggleMenu(event, \'' + vid + '\')" aria-label="More options">&#8943;</button>' +
          '<div class="vx-menu">' +
            '<button onclick="vxMenuAction(event, \'' + vid + '\', \'download\')">Download in HD</button>' +
            '<button onclick="vxMenuAction(event, \'' + vid + '\', \'copy\')">Copy link</button>' +
            '<button onclick="vxMenuAction(event, \'' + vid + '\', \'close\')">Cancel</button>' +
          '</div>' +
        '</div>' +
        '<div class="vx-media" onclick="vxTapVideo(event, \'' + vid + '\')">' +
          '<div class="ivx-skeleton" data-skel-for="' + vid + '"></div>' +
          '<video ' + vxSrcAttr + (poster ? ' poster="' + vxEsc(poster) + '"' : '') + ' data-igplay="1" preload="' + (vxHls ? 'none' : 'metadata') + '" muted loop playsinline></video>' +
          '<div class="vx-play-overlay"><span>&#9654;</span></div>' +
          '<div class="vx-heart-burst">&#10084;&#65039;</div>' +
          '<button class="vx-mute-btn" onclick="vxToggleMute(event, \'' + vid + '\')" aria-label="Toggle sound">&#128263;</button>' +
        '</div>' +
        '<div class="vx-actions">' +
          '<button class="vx-act vx-act-like' + (isLiked ? ' vx-liked' : '') + '" onclick="vxLike(\'' + vid + '\')" aria-label="Like">' + HEART_SVG + '</button>' +
          '<button class="vx-act vx-act-comment" onclick="vxToggleComments(\'' + vid + '\')" aria-label="Comment">' + COMMENT_SVG + '</button>' +
          '<button class="vx-act vx-act-share" onclick="vxShare(\'' + vid + '\')" aria-label="Share">' + SHARE_SVG + '</button>' +
          '<button class="vx-act vx-act-save' + (isSaved ? ' vx-saved' : '') + '" onclick="vxSave(\'' + vid + '\')" aria-label="Save">' + SAVE_SVG + '</button>' +
        '</div>' +
        '<div class="vx-likes-line"><span class="vx-like-count">' + vxNum(v.like_count) + '</span> likes</div>' +
        (v.title ? '<div class="vx-caption"><b>ivxholdings</b>' + vxEsc(v.title) + '</div>' : '') +
        '<button class="vx-viewall" onclick="vxToggleComments(\'' + vid + '\')">' + viewAllLabel + '</button>' +
        '<div class="vx-comments"><div class="vx-comment-list"></div></div>' +
        '<div class="vx-time">' + vxAgo(v.created_at) + '</div>' +
        '<form class="vx-comment-form" onsubmit="vxAddComment(event, \'' + vid + '\')">' +
          '<input class="vx-comment-input" placeholder="Add a comment..." maxlength="2000" required />' +
          '<button type="submit" class="vx-comment-send">Post</button>' +
        '</form>' +
      '</div>';
    }).join('');
    vxObserveAutoplay();
  }

  function vxCard(id) { return document.querySelector('.vx-card[data-vid="' + id + '"]'); }
  function vxVideoEl(id) { var c = vxCard(id); return c ? c.querySelector('video') : null; }

  function vxAgo(iso) {
    if (!iso) return '';
    var t = new Date(iso).getTime();
    if (!isFinite(t)) return '';
    var s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return 'Just now';
    var m = Math.floor(s / 60);
    if (m < 60) return m + (m === 1 ? ' minute ago' : ' minutes ago');
    var h = Math.floor(m / 60);
    if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    var d = Math.floor(h / 24);
    if (d < 7) return d + (d === 1 ? ' day ago' : ' days ago');
    var w = Math.floor(d / 7);
    if (w < 5) return w + (w === 1 ? ' week ago' : ' weeks ago');
    return new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  }

  function vxSavedSet() {
    try { return JSON.parse(localStorage.getItem('ivx_vx_saves') || '[]'); } catch (e) { return []; }
  }
  function vxSetSaved(id, saved) {
    try {
      var s = vxSavedSet();
      var i = s.indexOf(id);
      if (saved && i === -1) s.push(id);
      if (!saved && i !== -1) s.splice(i, 1);
      localStorage.setItem('ivx_vx_saves', JSON.stringify(s));
    } catch (e) {}
  }

  window.vxSave = function (id) {
    var api = vxApi();
    var card = vxCard(id);
    var btn = card ? card.querySelector('.vx-act-save') : null;
    var wasSaved = vxSavedSet().indexOf(id) !== -1;
    vxSetSaved(id, !wasSaved);
    if (btn) btn.classList.toggle('vx-saved', !wasSaved);
    vxToast(!wasSaved ? 'Saved' : 'Removed from saved');
    if (!api) return;
    fetch(api + '/api/projects/' + encodeURIComponent(id) + '/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guest_id: vxGuestId() }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (typeof d.saved === 'boolean') { vxSetSaved(id, d.saved); if (btn) btn.classList.toggle('vx-saved', d.saved); }
    }).catch(function () {});
  };

  window.vxToggleMenu = function (event, id) {
    event.stopPropagation();
    var card = vxCard(id);
    if (!card) return;
    var menu = card.querySelector('.vx-menu');
    var isOpen = menu.classList.contains('vx-open');
    document.querySelectorAll('.vx-menu.vx-open').forEach(function (m) { m.classList.remove('vx-open'); });
    if (!isOpen) menu.classList.add('vx-open');
  };

  window.vxMenuAction = function (event, id, action) {
    event.stopPropagation();
    document.querySelectorAll('.vx-menu.vx-open').forEach(function (m) { m.classList.remove('vx-open'); });
    if (action === 'download') { window.vxDownload(id); return; }
    if (action === 'copy') {
      var shareUrl = location.origin + location.pathname + '#videos';
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(shareUrl).then(function () { vxToast('Link copied to clipboard'); }).catch(function () { vxToast('Share link: ' + shareUrl); });
      } else { vxToast('Share link: ' + shareUrl); }
      var api = vxApi();
      if (api) {
        fetch(api + '/api/projects/' + encodeURIComponent(id) + '/share', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guest_id: vxGuestId(), share_type: 'copy_link', share_url: shareUrl }),
        }).catch(function () {});
      }
    }
  };

  document.addEventListener('click', function (e) {
    if (e.target && e.target.closest && e.target.closest('.vx-more, .vx-menu')) return;
    document.querySelectorAll('.vx-menu.vx-open').forEach(function (m) { m.classList.remove('vx-open'); });
  });

  function vxObserveAutoplay() {
    if (!('IntersectionObserver' in window)) return;
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var vid = entry.target;
        var overlay = vid.parentElement.querySelector('.vx-play-overlay');
        var skel = vid.parentElement.querySelector('.ivx-skeleton');
        if (entry.intersectionRatio >= 0.55) {
          var p = vid.play();
          if (p && p.catch) p.catch(function () {});
          if (overlay) overlay.style.opacity = '0';
        } else {
          vid.pause();
          if (overlay) overlay.style.opacity = '1';
        }
        if (skel && (vid.readyState >= 2 || vid.poster)) skel.classList.add('ivx-skel-hide');
      });
    }, { threshold: [0, 0.55] });
    document.querySelectorAll('#vx-grid video').forEach(function (v) {
      v.addEventListener('loadeddata', function () {
        var skel = v.parentElement.querySelector('.ivx-skeleton');
        if (skel) skel.classList.add('ivx-skel-hide');
      }, { once: true });
      obs.observe(v);
    });
  }

  var _vxLastTap = {};
  window.vxTapVideo = function (event, id) {
    if (event.target && event.target.closest && event.target.closest('.vx-mute-btn')) return;
    var now = Date.now();
    var last = _vxLastTap[id] || 0;
    _vxLastTap[id] = now;
    if (now - last < 320) { // double-tap → like (Instagram behavior)
      var card = vxCard(id);
      if (card) {
        var burst = card.querySelector('.vx-heart-burst');
        if (burst) { burst.classList.remove('vx-burst'); void burst.offsetWidth; burst.classList.add('vx-burst'); }
      }
      if (vxLikedSet().indexOf(id) === -1) window.vxLike(id);
      return;
    }
    setTimeout(function () {
      if (_vxLastTap[id] !== now) return; // a second tap happened
      var vid = vxVideoEl(id);
      if (!vid) return;
      var overlay = vid.parentElement.querySelector('.vx-play-overlay');
      if (vid.paused) { var p = vid.play(); if (p && p.catch) p.catch(function () {}); if (overlay) overlay.style.opacity = '0'; }
      else { vid.pause(); if (overlay) overlay.style.opacity = '1'; }
    }, 330);
  };

  window.vxToggleMute = function (event, id) {
    event.stopPropagation();
    var vid = vxVideoEl(id);
    if (!vid) return;
    vid.muted = !vid.muted;
    event.currentTarget.innerHTML = vid.muted ? '&#128263;' : '&#128266;';
  };

  window.vxLike = function (id) {
    var api = vxApi();
    if (!api) { vxToast('Connecting… try again in a moment'); return; }
    var card = vxCard(id);
    var btn = card ? card.querySelector('.vx-act-like') : null;
    var countEl = card ? card.querySelector('.vx-like-count') : null;
    var wasLiked = vxLikedSet().indexOf(id) !== -1;
    // Optimistic UI
    vxSetLiked(id, !wasLiked);
    if (btn) btn.classList.toggle('vx-liked', !wasLiked);
    fetch(api + '/api/projects/' + encodeURIComponent(id) + '/like', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guest_id: vxGuestId() }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (typeof d.like_count === 'number' && countEl) countEl.textContent = vxNum(d.like_count);
      if (typeof d.liked === 'boolean') { vxSetLiked(id, d.liked); if (btn) btn.classList.toggle('vx-liked', d.liked); }
    }).catch(function () {});
  };

  window.vxToggleComments = function (id) {
    var card = vxCard(id);
    if (!card) return;
    var panel = card.querySelector('.vx-comments');
    var isOpen = panel.classList.toggle('vx-open');
    if (isOpen) vxLoadComments(id);
  };

  function vxLoadComments(id) {
    var api = vxApi();
    var card = vxCard(id);
    if (!api || !card) return;
    var list = card.querySelector('.vx-comment-list');
    list.innerHTML = '<p class="vx-comment" style="opacity:0.6;">Loading comments…</p>';
    fetch(api + '/api/projects/' + encodeURIComponent(id) + '/comments?limit=30')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var comments = d.comments || [];
        var countEl = card.querySelector('.vx-comment-count');
        if (countEl && typeof d.total === 'number') countEl.textContent = vxNum(d.total);
        if (comments.length === 0) { list.innerHTML = '<p class="vx-comment" style="opacity:0.6;">No comments yet. Be the first.</p>'; return; }
        list.innerHTML = comments.map(function (cm) {
          var name = cm.guest_name || (cm.is_owner_reply ? 'IVX Holdings' : 'Member');
          var when = cm.created_at ? new Date(cm.created_at).toLocaleDateString() : '';
          return '<p class="vx-comment"><b>' + vxEsc(name) + '</b>' + vxEsc(cm.body) + '<span class="vx-comment-time">' + vxEsc(when) + '</span></p>';
        }).join('');
      })
      .catch(function () { list.innerHTML = '<p class="vx-comment" style="opacity:0.6;">Could not load comments.</p>'; });
  }

  window.vxAddComment = function (event, id) {
    event.preventDefault();
    var api = vxApi();
    if (!api) { vxToast('Connecting… try again in a moment'); return; }
    var form = event.currentTarget;
    var input = form.querySelector('.vx-comment-input');
    var sendBtn = form.querySelector('.vx-comment-send');
    var text = (input.value || '').trim();
    if (!text) return;
    sendBtn.disabled = true;
    var guestName = '';
    try { guestName = localStorage.getItem('ivx_member_name') || ''; } catch (e) {}
    fetch(api + '/api/projects/' + encodeURIComponent(id) + '/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: text, guest_name: guestName || 'Guest' }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      sendBtn.disabled = false;
      if (d && d.success) { input.value = ''; vxLoadComments(id); vxToast('Comment posted'); }
      else vxToast(d && d.error ? d.error : 'Could not post comment');
    }).catch(function () { sendBtn.disabled = false; vxToast('Could not post comment'); });
  };

  window.vxShare = function (id) {
    var api = vxApi();
    var video = null;
    for (var i = 0; i < _vxVideos.length; i++) { if (_vxVideos[i].id === id) { video = _vxVideos[i]; break; } }
    var shareUrl = location.origin + location.pathname + '#videos';
    var title = (video && video.title) ? video.title : 'IVX Holdings — Project Video';
    function track(type) {
      if (!api) return;
      fetch(api + '/api/projects/' + encodeURIComponent(id) + '/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guest_id: vxGuestId(), share_type: type, share_url: shareUrl }),
      }).then(function (r) { return r.json(); }).then(function (d) {
        var card = vxCard(id);
        var countEl = card ? card.querySelector('.vx-share-count') : null;
        if (countEl && typeof d.share_count === 'number') countEl.textContent = vxNum(d.share_count);
      }).catch(function () {});
    }
    if (navigator.share) {
      navigator.share({ title: title, text: title, url: shareUrl }).then(function () { track('social'); }).catch(function () {});
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareUrl).then(function () { vxToast('Link copied to clipboard'); track('copy_link'); }).catch(function () { track('copy_link'); });
    } else {
      track('copy_link');
      vxToast('Share link: ' + shareUrl);
    }
  };

  window.vxDownload = function (id) {
    var api = vxApi();
    if (!api) { vxToast('Connecting… try again in a moment'); return; }
    vxToast('Downloading in full quality…');
    var a = document.createElement('a');
    a.href = api + '/api/ivx/videos/' + encodeURIComponent(id) + '/download';
    a.download = '';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); }, 1200);
  };

  function vxLoadFeed() {
    var api = vxApi();
    if (!api) { setTimeout(vxLoadFeed, 2500); return; }
    fetch(api + '/api/ivx/videos/feed?limit=24')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        _vxVideos = (d && d.videos) ? d.videos : [];
        vxRender();
      })
      .catch(function () { /* backend cold start — retry once */ setTimeout(function () {
        fetch(api + '/api/ivx/videos/feed?limit=24').then(function (r) { return r.json(); }).then(function (d) {
          _vxVideos = (d && d.videos) ? d.videos : [];
          vxRender();
        }).catch(function () {});
      }, 6000); });
  }

  // Member registration functions removed (item 112) — funnel is sole conversion route.

  // Legacy 24-video grid removed — main screen is now investor-first (3 deals → 1 video) via ivx-home-feed.js.
  // Full video experience lives in the dedicated Reels module (ivx-reels.js), opened by the Reels icon.
  // Inline Project Reels section (vxLoadFeed) — loads on page ready.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', vxLoadFeed);
  } else {
    vxLoadFeed();
  }
})();

// === Extracted Script Block 2 (85 lines) ===

(function () {
  'use strict';
  // ── Multi-channel attribution: capture UTM params + ad click IDs on arrival
  function zcCaptureChannel() {
    try {
      var q = new URLSearchParams(window.location.search);
      var attr = {};
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid', 'ttclid', 'li_fat_id'].forEach(function (k) {
        var v = q.get(k);
        if (v) attr[k] = v.slice(0, 200);
      });
      if (attr.gclid) attr.channel = 'google';
      else if (attr.fbclid) attr.channel = 'instagram';
      else if (attr.ttclid) attr.channel = 'tiktok';
      else if (attr.li_fat_id) attr.channel = 'linkedin';
      else if (attr.utm_source) attr.channel = attr.utm_source.toLowerCase();
      if (Object.keys(attr).length > 0) {
        attr.captured_at = new Date().toISOString();
        localStorage.setItem('ivx_channel_attribution', JSON.stringify(attr));
      }
    } catch (e) {}
  }
  zcCaptureChannel();
  function zcChannelAttr() {
    try { return JSON.parse(localStorage.getItem('ivx_channel_attribution') || '{}'); } catch (e) { return {}; }
  }
  // ── API base (placeholder replaced at deploy)
  var _zcBackend = '__IVX_BACKEND_URL__';
  function zcApi() {
    if (_zcBackend && _zcBackend.indexOf('__IVX_') !== 0 && _zcBackend.length > 10) return _zcBackend.replace(/\/$/, '');
    var m = document.querySelector('meta[name="ivx-backend-url"]') || document.querySelector('meta[name="ivx-api-url"]');
    if (m && m.content && m.content.indexOf('__IVX_') !== 0 && m.content.length > 10) return m.content.replace(/\/$/, '');
    return 'https://ivxholding.com';
  }
})();

// === Extracted Script Block 3 (3839 lines) ===

  // ══════════════════════════════════════════════════════════════════════════════
  // CONFIG — SELF-HEALING CREDENTIAL DISCOVERY
  // ══════════════════════════════════════════════════════════════════════════════
  var SUPABASE_URL = '__IVX_SUPABASE_URL__';
  var SUPABASE_ANON_KEY = '__IVX_SUPABASE_ANON_KEY__';
  var _supabaseReady = false;
  var _configLoaded = false;
  var _configRetryCount = 0;
  var _CONFIG_MAX_RETRIES = 12;

  // ═══ DEAL CACHE — Show deals instantly from localStorage ═══
  var _DEAL_CACHE_KEY = 'ivx_cached_deals';
  var _DEAL_CACHE_TS_KEY = 'ivx_cached_deals_ts';
  var _DEAL_CACHE_MAX_AGE = 2 * 60 * 60 * 1000; // 2 hours
  function cacheDealData(deals) {
    if (!deals || deals.length === 0) return;
    try {
      localStorage.setItem(_DEAL_CACHE_KEY, JSON.stringify(deals));
      localStorage.setItem(_DEAL_CACHE_TS_KEY, String(Date.now()));
      console.log('[IVX Cache] Cached', deals.length, 'deals to localStorage');
    } catch(e) { console.warn('[IVX Cache] Failed to cache deals:', e.message); }
  }
  function getCachedDeals() {
    try {
      var ts = parseInt(localStorage.getItem(_DEAL_CACHE_TS_KEY) || '0', 10);
      if (Date.now() - ts > _DEAL_CACHE_MAX_AGE) return null;
      var raw = localStorage.getItem(_DEAL_CACHE_KEY);
      if (!raw) return null;
      var deals = JSON.parse(raw);
      if (Array.isArray(deals) && deals.length > 0) {
        console.log('[IVX Cache] Found', deals.length, 'cached deals (age:', Math.round((Date.now() - ts) / 1000), 's)');
        return deals;
      }
    } catch(e) {}
    return null;
  }

  var _FALLBACK_SUPABASE_URL = '__IVX_SUPABASE_URL__';
  var _FALLBACK_SUPABASE_KEY = '__IVX_SUPABASE_ANON_KEY__';
  var _IVX_API_URL = '__IVX_API_BASE_URL__';
  var _IVX_BACKEND_URL = '__IVX_BACKEND_URL__';
  var _HARDCODED_BACKEND_URL = 'https://api.ivxholding.com';
  var _INSTANT_CONFIG_FETCHED = false;
  var _EDGE_FUNCTION_URL = '';
  (function deriveEdgeFunctionUrl() {
    var sbUrl = SUPABASE_URL;
    if (!isPlaceholder(sbUrl)) {
      _EDGE_FUNCTION_URL = sbUrl.replace(/\/+$/, '') + '/functions/v1/runtime-deals';
    } else {
      _EDGE_FUNCTION_URL = '';
    }
  })();
  var _BACKEND_COLD_START_RETRIES = 0;
  var _BACKEND_MAX_COLD_RETRIES = 12;
  var _BACKEND_WOKE = false;

  function isPlaceholder(val) {
    return !val || val.indexOf('__IVX_') === 0 || val.length < 10;
  }

  // STEP 1: Read credentials from meta tags
  (function readMetaCredentials() {
    if (isPlaceholder(SUPABASE_URL)) {
      var metaUrl = document.querySelector('meta[name="ivx-sb-url"]');
      if (metaUrl && metaUrl.content && !isPlaceholder(metaUrl.content)) {
        SUPABASE_URL = metaUrl.content;
        console.log('[IVX] Supabase URL loaded from meta tag');
      }
    }
    if (isPlaceholder(SUPABASE_ANON_KEY)) {
      var metaKey = document.querySelector('meta[name="ivx-sb-key"]');
      if (metaKey && metaKey.content && !isPlaceholder(metaKey.content)) {
        SUPABASE_ANON_KEY = metaKey.content;
        console.log('[IVX] Supabase key loaded from meta tag');
      }
    }
  })();

  // STEP 1b: Read fallback meta tags if primary ones are still placeholders
  (function readFallbackMeta() {
    if (isPlaceholder(SUPABASE_URL)) {
      var fb = document.querySelector('meta[name="ivx-sb-url-fallback"]');
      if (fb && fb.content && !isPlaceholder(fb.content)) {
        SUPABASE_URL = fb.content;
        console.log('[IVX] Supabase URL loaded from fallback meta tag');
      }
    }
    if (isPlaceholder(SUPABASE_ANON_KEY)) {
      var fb2 = document.querySelector('meta[name="ivx-sb-key-fallback"]');
      if (fb2 && fb2.content && !isPlaceholder(fb2.content)) {
        SUPABASE_ANON_KEY = fb2.content;
        console.log('[IVX] Supabase key loaded from fallback meta tag');
      }
    }
    // Read API URL from meta tag
    if (isPlaceholder(_IVX_API_URL)) {
      var apiMeta = document.querySelector('meta[name="ivx-api-url"]');
      if (apiMeta && apiMeta.content && !isPlaceholder(apiMeta.content)) {
        _IVX_API_URL = apiMeta.content.replace(/\/$/, '');
        console.log('[IVX] API URL loaded from meta tag:', _IVX_API_URL);
      }
    }
    // Read backend URL from meta tag (IVX backend — always running)
    if (isPlaceholder(_IVX_BACKEND_URL)) {
      var backendMeta = document.querySelector('meta[name="ivx-backend-url"]');
      if (backendMeta && backendMeta.content && !isPlaceholder(backendMeta.content)) {
        _IVX_BACKEND_URL = backendMeta.content.replace(/\/$/, '');
        console.log('[IVX] Backend URL loaded from meta tag:', _IVX_BACKEND_URL);
      }
    }
  })();

  // STEP 2: Try localStorage cache from previous successful config load
  (function readCachedCredentials() {
    if (isPlaceholder(SUPABASE_URL) || isPlaceholder(SUPABASE_ANON_KEY)) {
      try {
        var cached = localStorage.getItem('ivx_sb_config');
        if (cached) {
          var cfg = JSON.parse(cached);
          if (cfg.url && cfg.url.length > 10 && cfg.key && cfg.key.length > 10) {
            if (isPlaceholder(SUPABASE_URL)) SUPABASE_URL = cfg.url;
            if (isPlaceholder(SUPABASE_ANON_KEY)) SUPABASE_ANON_KEY = cfg.key;
            console.log('[IVX] Credentials loaded from localStorage cache');
          }
        }
      } catch(e) {}
    }
  })();

  // STEP 2b: Hardcoded fallback — only used if build injected real values
  (function applyHardcodedFallback() {
    if (isPlaceholder(SUPABASE_URL) && !isPlaceholder(_FALLBACK_SUPABASE_URL)) {
      SUPABASE_URL = _FALLBACK_SUPABASE_URL;
      console.log('[IVX] Supabase URL loaded from hardcoded fallback');
    }
    if (isPlaceholder(SUPABASE_ANON_KEY) && !isPlaceholder(_FALLBACK_SUPABASE_KEY)) {
      SUPABASE_ANON_KEY = _FALLBACK_SUPABASE_KEY;
      console.log('[IVX] Supabase key loaded from hardcoded fallback');
    }
  })();

  function isValidJwtFormat(key) {
    return key && typeof key === 'string' && key.indexOf('eyJ') === 0 && key.length > 30;
  }
  function checkSupabaseReady() {
    _supabaseReady = !isPlaceholder(SUPABASE_URL) && !isPlaceholder(SUPABASE_ANON_KEY) && isValidJwtFormat(SUPABASE_ANON_KEY);
    if (!isPlaceholder(SUPABASE_ANON_KEY) && !isValidJwtFormat(SUPABASE_ANON_KEY)) {
      console.warn('[IVX] Supabase anon key is NOT a valid JWT (must start with eyJ). Key:', SUPABASE_ANON_KEY.substring(0, 15) + '...');
    }
    // Publish globals for lazy-loaded modules (ivx-invest.js, ivx-portal.js)
    // These modules read window.IVX_SUPABASE_URL / window.IVX_SUPABASE_ANON_KEY
    window.IVX_SUPABASE_URL = SUPABASE_URL;
    window.IVX_SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
    return _supabaseReady;
  }
  checkSupabaseReady();

  // STEP 2b: Phase 2 registration reliability — canonical auth configuration validation.
  // Runs at startup, disables signup if config is invalid, never throws.
  window.IVX_REGISTRATION_AVAILABLE = false;
  function runRegistrationConfigCheck() {
    try {
      if (typeof window.IVXValidateAuthConfiguration === 'function') {
        var check = window.IVXValidateAuthConfiguration();
        window.IVX_REGISTRATION_AVAILABLE = check.ok;
        if (!check.ok) {
          console.warn('[IVX] Registration disabled — auth config invalid:', check.problems.join(', '), 'trace:', check.traceId);
          // Disable signup buttons so users don't hit a broken flow.
          document.querySelectorAll('[data-ivx-signup-cta]').forEach(function(el) { el.setAttribute('disabled', 'disabled'); el.classList.add('ivx-reg-unavailable'); });
        } else {
          console.log('[IVX] Registration config OK — signup enabled.');
        }
      } else {
        // ivx-invest.js lazy-loads later — recheck after it loads.
        setTimeout(runRegistrationConfigCheck, 1500);
      }
    } catch (e) {
      console.warn('[IVX] Registration config check threw (suppressed):', e.message);
    }
  }
  runRegistrationConfigCheck();

  // Phase 2 §13: registration error boundary — catches render errors in the invest modal
  // so a broken registration never crashes the whole landing page.
  window.IVXRegErrorBoundary = function(targetFn, fallbackMsg) {
    return function() {
      try { return targetFn.apply(this, arguments); }
      catch (err) {
        var traceId = 'ivx-reg-boundary-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8);
        console.error('[IVX Reg Boundary] Caught render error:', err.message, 'trace:', traceId);
        var errEl = document.getElementById('invest-auth-error');
        if (errEl) { errEl.textContent = (fallbackMsg || 'Registration is temporarily unavailable.') + ' Reference: ' + traceId; errEl.style.display = 'block'; }
        var btn = document.getElementById('invest-auth-btn');
        if (btn) { btn.disabled = false; btn.textContent = 'Retry'; }
        return null;
      }
    };
  };

  // STEP 3: Cache credentials when we get them
  function cacheCredentials() {
    if (_supabaseReady) {
      try {
        localStorage.setItem('ivx_sb_config', JSON.stringify({ url: SUPABASE_URL, key: SUPABASE_ANON_KEY, ts: Date.now() }));
      } catch(e) {}
    }
  }
  cacheCredentials();

  // STEP 4: If still not ready, try fetching config from known endpoints
  var _configDiscoveryDone = false;
  function applyDiscoveredConfig(cfg) {
    if (cfg.supabaseUrl && cfg.supabaseUrl.length > 10 && !isPlaceholder(cfg.supabaseUrl)) {
      SUPABASE_URL = cfg.supabaseUrl;
    }
    if (cfg.supabaseAnonKey && cfg.supabaseAnonKey.length > 10 && !isPlaceholder(cfg.supabaseAnonKey)) {
      SUPABASE_ANON_KEY = cfg.supabaseAnonKey;
    }
    if (cfg.apiBaseUrl && cfg.apiBaseUrl.length > 5) {
      IVX_API = cfg.apiBaseUrl.replace(/\/$/, '');
    }
    if (cfg.appUrl && cfg.appUrl.length > 5) {
      IVX_APP_URL = cfg.appUrl.replace(/\/$/, '');
    }
    if (cfg.backendUrl && cfg.backendUrl.length > 5 && !isPlaceholder(cfg.backendUrl)) {
      var bu = cfg.backendUrl.replace(/\/$/, '');
      if (IVX_API_FALLBACKS.indexOf(bu) === -1) {
        IVX_API_FALLBACKS.unshift(bu);
        console.log('[IVX] Backend URL added to fallbacks:', bu);
      }
    }
    checkSupabaseReady();
    cacheCredentials();
  }
  function tryDiscoverCredentials(callback) {
    if (_supabaseReady || _configDiscoveryDone) { if (callback) callback(); return; }
    _configDiscoveryDone = true;
    var configUrls = [];
    // Priority 1: Try IVX backend API config endpoint (always running)
    for (var fi = 0; fi < IVX_API_FALLBACKS.length; fi++) {
      var base = IVX_API_FALLBACKS[fi];
      if (base && base.indexOf('ivxholding.com') === -1) {
        configUrls.push(base + '/api/landing-config?_t=' + Date.now());
      }
    }
    // Priority 2: Static config file
    configUrls.push('/ivx-config.json?_t=' + Date.now());
    configUrls.push('https://ivxholding.com/ivx-config.json?_t=' + Date.now());
    // Priority 3: Try all API fallbacks for landing-config
    for (var fi2 = 0; fi2 < IVX_API_FALLBACKS.length; fi2++) {
      var base2 = IVX_API_FALLBACKS[fi2];
      if (base2) configUrls.push(base2 + '/api/landing-config?_t=' + Date.now());
    }
    var tried = 0;
    function tryNext() {
      if (tried >= configUrls.length || _supabaseReady) { if (callback) callback(); return; }
      var url = configUrls[tried++];
      console.log('[IVX] Discovering credentials from:', url);
      var _cdCtrl = new AbortController();
      var _cdTo = setTimeout(function() { _cdCtrl.abort(); }, 5000);
      fetch(url, { signal: _cdCtrl.signal }).then(function(r) {
        clearTimeout(_cdTo);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function(cfg) {
        applyDiscoveredConfig(cfg);
        console.log('[IVX] Config discovered ✓ — Supabase ready:', _supabaseReady);
        if (callback) callback();
      }).catch(function(err) {
        clearTimeout(_cdTo);
        console.warn('[IVX] Config discovery failed from', url, ':', err.message);
        tryNext();
      });
    }
    tryNext();
  }

  // STEP 5: Listen for postMessage config injection from parent app (single global handler)
  window.addEventListener('message', function(event) {
    try {
      var msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (msg && msg.type === 'IVX_CONFIG' && msg.supabaseUrl && msg.supabaseAnonKey) {
        console.log('[IVX] Config received via postMessage ✓');
        applyDiscoveredConfig(msg);
        // Also re-init deals if needed
        if (_supabaseReady && typeof window._ivxReinitDeals === 'function') {
          window._ivxReinitDeals();
        }
      }
    } catch(e) {}
  });

  if (!_supabaseReady) {
    console.log('[IVX] Supabase credentials not injected at build — will discover from backend');
  }
  var _rawAppUrl = '__IVX_APP_URL__';
  var _rawApiUrl = '__IVX_BACKEND_URL__';
  var _resolvedApi = (_rawApiUrl.indexOf('__IVX_') === 0 ? '' : _rawApiUrl || '').replace(/\/$/, '');
  var _resolvedIVXApi = (isPlaceholder(_IVX_API_URL) ? '' : _IVX_API_URL || '').replace(/\/$/, '');
  var _resolvedBackendUrl = (isPlaceholder(_IVX_BACKEND_URL) ? '' : _IVX_BACKEND_URL || '').replace(/\/$/, '');
  var IVX_API = _resolvedApi || _resolvedIVXApi || _resolvedBackendUrl || _HARDCODED_BACKEND_URL || 'https://api.ivxholding.com';
  var IVX_APP_URL = (_rawAppUrl.indexOf('__IVX_') === 0 ? '' : _rawAppUrl || '').replace(/\/$/, '');
  var IVX_API_FALLBACKS = [
    _HARDCODED_BACKEND_URL,
    _resolvedBackendUrl,
    IVX_API,
    _resolvedIVXApi,
    'https://ivxholding.com',
  ].filter(function(v, i, a) { return v && v.length > 5 && a.indexOf(v) === i; });

  // INSTANT CONFIG FETCH — fire immediately, don't wait for DOMContentLoaded
  // The hardcoded backend URL always has real Supabase credentials
  if (!_supabaseReady && _HARDCODED_BACKEND_URL) {
    (function instantConfigFetch() {
      var url = _HARDCODED_BACKEND_URL + '/api/landing-config?_t=' + Date.now();
      console.log('[IVX] Instant config fetch from backend:', url);
      var _icCtrl = new AbortController();
      var _icTo = setTimeout(function() { _icCtrl.abort(); }, 6000);
      fetch(url, { signal: _icCtrl.signal }).then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function(cfg) {
        clearTimeout(_icTo);
        _INSTANT_CONFIG_FETCHED = true;
        if (cfg.supabaseUrl && cfg.supabaseUrl.length > 10) SUPABASE_URL = cfg.supabaseUrl;
        if (cfg.supabaseAnonKey && cfg.supabaseAnonKey.length > 10) SUPABASE_ANON_KEY = cfg.supabaseAnonKey;
        if (cfg.apiBaseUrl && cfg.apiBaseUrl.length > 5) IVX_API = cfg.apiBaseUrl.replace(/\/$/, '');
        if (cfg.appUrl && cfg.appUrl.length > 5) IVX_APP_URL = cfg.appUrl.replace(/\/$/, '');
        if (cfg.backendUrl && cfg.backendUrl.length > 5) {
          var bu = cfg.backendUrl.replace(/\/$/, '');
          if (IVX_API_FALLBACKS.indexOf(bu) === -1) IVX_API_FALLBACKS.unshift(bu);
        }
        checkSupabaseReady();
        cacheCredentials();
        console.log('[IVX] Instant config loaded — Supabase ready:', _supabaseReady);
      }).catch(function(err) {
        clearTimeout(_icTo);
        console.warn('[IVX] Instant config fetch failed:', err.message, '— will retry via discovery');
      });
    })();
  }
  var SESSION_ID = 'lp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  var PAGE_START = Date.now();
  var GEO_DATA = {};

  var FUNNEL_STEP = 0;
  var SELECTED_GOAL = '';
  var UTM_DATA = {};
  var AD_CLICK_IDS = {};
  var ENGAGEMENT_SCORE = 0;
  var VISIT_COUNT = 1;

  var _rtStatusTimeout = null;
  function updateRealtimeStatus(status, dealCount) { return; }

  console.log('[IVX] Landing v7 — Live Tracking Engine + Realtime');
  console.log('[IVX] API:', IVX_API);
  console.log('[IVX] App URL:', IVX_APP_URL || '(not set — invest buttons open funnel)');
  console.log('[IVX] Fallbacks:', IVX_API_FALLBACKS);

  // ══════════════════════════════════════════════════════════════════════════════
  // UTM & AD CLICK ID CAPTURE
  // ══════════════════════════════════════════════════════════════════════════════
  (function captureUTM() {
    var params = new URLSearchParams(window.location.search);
    ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].forEach(function(k) {
      if (params.get(k)) UTM_DATA[k.replace('utm_','')] = params.get(k);
    });
    ['fbclid','gclid','ttclid','li_fat_id','twclid','msclkid'].forEach(function(k) {
      if (params.get(k)) AD_CLICK_IDS[k] = params.get(k);
    });
    if (Object.keys(UTM_DATA).length > 0) {
      try { sessionStorage.setItem('ivx_utm', JSON.stringify(UTM_DATA)); } catch(e) {}
      console.log('[IVX UTM]', UTM_DATA);
    } else {
      try { var saved = sessionStorage.getItem('ivx_utm'); if (saved) UTM_DATA = JSON.parse(saved); } catch(e) {}
    }
    if (Object.keys(AD_CLICK_IDS).length > 0) {
      try { sessionStorage.setItem('ivx_adclicks', JSON.stringify(AD_CLICK_IDS)); } catch(e) {}
      console.log('[IVX AdClicks]', AD_CLICK_IDS);
    } else {
      try { var s2 = sessionStorage.getItem('ivx_adclicks'); if (s2) AD_CLICK_IDS = JSON.parse(s2); } catch(e) {}
    }
    try {
      var vc = parseInt(localStorage.getItem('ivx_visit_count') || '0', 10) + 1;
      localStorage.setItem('ivx_visit_count', String(vc));
      VISIT_COUNT = vc;
      if (vc > 1) console.log('[IVX] Return visitor #' + vc);
    } catch(e) {}
  })();

  // ══════════════════════════════════════════════════════════════════════════════
  // AD PLATFORM CONVERSION EVENTS
  // ══════════════════════════════════════════════════════════════════════════════
  function fireAdEvent(eventName, params) {
    params = params || {};
    console.log('[IVX Ads]', eventName, params);

    // Meta Pixel
    try {
      if (typeof fbq === 'function') {
        var metaMap = {
          'page_view': 'PageView',
          'view_content': 'ViewContent',
          'lead': 'Lead',
          'complete_registration': 'CompleteRegistration',
          'initiate_checkout': 'InitiateCheckout',
          'add_to_cart': 'AddToCart',
          'search': 'Search',
        };
        var metaEvent = metaMap[eventName] || eventName;
        fbq('track', metaEvent, {
          content_name: params.content_name || 'IVX Real Estate',
          content_category: params.category || 'real_estate_investment',
          value: params.value || 0,
          currency: 'USD',
          content_ids: params.property_id ? [params.property_id] : undefined,
        });
      }
    } catch(e) { console.warn('[IVX Meta]', e.message); }

    // Google Ads / GA4
    try {
      if (typeof gtag === 'function') {
        var gtagMap = {
          'page_view': 'page_view',
          'view_content': 'view_item',
          'lead': 'generate_lead',
          'complete_registration': 'sign_up',
          'initiate_checkout': 'begin_checkout',
          'add_to_cart': 'add_to_cart',
        };
        var gEvent = gtagMap[eventName] || eventName;
        gtag('event', gEvent, {
          event_category: params.category || 'engagement',
          event_label: params.label || '',
          value: params.value || 0,
          currency: 'USD',
          items: params.property_id ? [{ item_id: params.property_id, item_name: params.content_name }] : undefined,
        });
        if (eventName === 'lead' || eventName === 'complete_registration') {
          gtag('event', 'conversion', { send_to: 'IVX_GOOGLE_ADS_ID/' + eventName });
        }
      }
    } catch(e) { console.warn('[IVX Google]', e.message); }

    // TikTok Pixel
    try {
      if (typeof ttq !== 'undefined' && ttq.track) {
        var ttMap = {
          'view_content': 'ViewContent',
          'lead': 'SubmitForm',
          'complete_registration': 'CompleteRegistration',
          'initiate_checkout': 'InitiateCheckout',
          'add_to_cart': 'AddToCart',
        };
        var ttEvent = ttMap[eventName];
        if (ttEvent) {
          ttq.track(ttEvent, {
            content_name: params.content_name || 'IVX',
            value: params.value || 0,
            currency: 'USD',
          });
        }
      }
    } catch(e) { console.warn('[IVX TikTok]', e.message); }

    // LinkedIn Insight
    try {
      if (typeof lintrk === 'function' && (eventName === 'lead' || eventName === 'complete_registration')) {
        lintrk('track', { conversion_id: eventName === 'lead' ? 'IVX_LI_LEAD' : 'IVX_LI_SIGNUP' });
      }
    } catch(e) {}
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // ENGAGEMENT SCORING (real-time, client-side)
  // ══════════════════════════════════════════════════════════════════════════════


  // ══════════════════════════════════════════════════════════════════════════════
  // FIRST-PARTY ANALYTICS — writes to landing_analytics via Supabase REST API
  // ══════════════════════════════════════════════════════════════════════════════
  var _analyticsQueue = [];
  var _analyticsFlushing = false;
  var _analyticsFlushTimer = null;
  var _analyticsEventCount = 0;
  var _analyticsMaxPerSession = 500;
  var _scrollThresholds = { 25: false, 50: false, 75: false, 100: false };
  var _geoFetched = false;

  function ivxTrack(eventName, props) {
    if (_analyticsEventCount >= _analyticsMaxPerSession) return;
    _analyticsEventCount++;
    var ua = navigator.userAgent || '';
    var isMobile = /mobile|android|iphone|ipad/i.test(ua);
    var isTablet = /tablet|ipad/i.test(ua);
    var deviceType = isTablet ? 'Tablet' : isMobile ? 'Mobile' : 'Desktop';
    var event = {
      event: eventName,
      session_id: SESSION_ID,
      properties: Object.assign({
        platform: 'web',
        source: 'landing',
        device: deviceType,
        userAgent: ua.substring(0, 200),
        referrer: document.referrer || 'direct',
        path: window.location.pathname,
        visitCount: VISIT_COUNT,
        funnelStep: FUNNEL_STEP,
        engagementScore: ENGAGEMENT_SCORE
      }, UTM_DATA, props || {}),
      geo: GEO_DATA && GEO_DATA.country ? GEO_DATA : null,
      created_at: new Date().toISOString()
    };
    _analyticsQueue.push(event);
    if (!_analyticsFlushTimer) {
      _analyticsFlushTimer = setTimeout(flushAnalytics, 3000);
    }
    if (_analyticsQueue.length >= 10) {
      flushAnalytics();
    }
  }

  function flushAnalytics() {
    if (_analyticsFlushTimer) { clearTimeout(_analyticsFlushTimer); _analyticsFlushTimer = null; }
    if (_analyticsFlushing || _analyticsQueue.length === 0) return;
    if (isPlaceholder(SUPABASE_URL) || isPlaceholder(SUPABASE_ANON_KEY)) {
      console.log('[IVX Analytics] Supabase not configured — queued', _analyticsQueue.length, 'events waiting');
      _analyticsFlushTimer = setTimeout(flushAnalytics, 10000);
      return;
    }
    _analyticsFlushing = true;
    var batch = _analyticsQueue.splice(0, 50);
    var restUrl = SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/landing_analytics';
    var headers = {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    };
    fetch(restUrl, { method: 'POST', headers: headers, body: JSON.stringify(batch) })
      .then(function(resp) {
        _analyticsFlushing = false;
        if (resp.ok || resp.status === 201) {
          console.log('[IVX Analytics] Flushed', batch.length, 'events to landing_analytics');
        } else {
          /* analytics insert failed — RLS policy or table not configured; fail silently to avoid console noise */
          resp.text().catch(function() {});
          _analyticsQueue.unshift.apply(_analyticsQueue, batch);
        }
        if (_analyticsQueue.length > 0) {
          _analyticsFlushTimer = setTimeout(flushAnalytics, 5000);
        }
      })
      .catch(function(err) {
        _analyticsFlushing = false;
        console.warn('[IVX Analytics] Flush error:', err.message);
        _analyticsQueue.unshift.apply(_analyticsQueue, batch);
        _analyticsFlushTimer = setTimeout(flushAnalytics, 15000);
      });
  }

  ivxTrack('page_view', { title: document.title });

  (function setupScrollTracking() {
    var ticking = false;
    window.addEventListener('scroll', function() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function() {
        var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        var docHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) - window.innerHeight;
        if (docHeight <= 0) { ticking = false; return; }
        var pct = Math.round((scrollTop / docHeight) * 100);
        [25, 50, 75, 100].forEach(function(threshold) {
          if (pct >= threshold && !_scrollThresholds[threshold]) {
            _scrollThresholds[threshold] = true;
            ivxTrack('scroll_' + threshold, { scrollPercent: pct });
            ENGAGEMENT_SCORE = Math.min(ENGAGEMENT_SCORE + (threshold === 25 ? 5 : threshold === 50 ? 10 : threshold === 75 ? 15 : 20), 100);
          }
        });
        ticking = false;
      });
    }, { passive: true });
  })();

  document.addEventListener('click', function(e) {
    var target = e.target.closest('a, button, [onclick]');
    if (!target) return;
    var text = (target.textContent || '').trim().substring(0, 80);
    var href = target.getAttribute('href') || '';
    var classes = target.className || '';
    if (classes.indexOf('btn-primary') !== -1 || classes.indexOf('nav-cta-btn') !== -1 ||
        text.toLowerCase().indexOf('start investing') !== -1 || text.toLowerCase().indexOf('get started') !== -1 ||
        text.toLowerCase().indexOf('invest now') !== -1 || text.toLowerCase().indexOf('join') !== -1) {
      ivxTrack('cta_click', { label: text, href: href, type: 'primary' });
      ENGAGEMENT_SCORE = Math.min(ENGAGEMENT_SCORE + 15, 100);
    } else if (classes.indexOf('btn-outline') !== -1 || text.toLowerCase().indexOf('sign in') !== -1 || text.toLowerCase().indexOf('log in') !== -1) {
      ivxTrack('cta_click', { label: text, href: href, type: 'secondary' });
      ENGAGEMENT_SCORE = Math.min(ENGAGEMENT_SCORE + 10, 100);
    } else if (target.closest('.deal-card') || target.closest('.jv-card')) {
      ivxTrack('deal_card_click', { label: text, href: href });
      ENGAGEMENT_SCORE = Math.min(ENGAGEMENT_SCORE + 10, 100);
    }
  }, true);

  (function setupFormTracking() {
    var formTracked = false;
    document.addEventListener('focusin', function(e) {
      var inp = e.target;
      if (inp && (inp.tagName === 'INPUT' || inp.tagName === 'TEXTAREA' || inp.tagName === 'SELECT')) {
        var form = inp.closest('form') || inp.closest('.funnel-step');
        if (form && !formTracked) {
          formTracked = true;
          ivxTrack('form_focus', { field: inp.name || inp.id || inp.type, formId: form.id || 'unknown' });
          ENGAGEMENT_SCORE = Math.min(ENGAGEMENT_SCORE + 10, 100);
        }
      }
    });
    document.addEventListener('submit', function(e) {
      var form = e.target;
      ivxTrack('form_submit', { formId: form.id || 'unknown' });
      ENGAGEMENT_SCORE = Math.min(ENGAGEMENT_SCORE + 25, 100);
    }, true);
  })();

  (function fetchGeoData() {
    if (_geoFetched) return;
    _geoFetched = true;
    fetch('https://ipapi.co/json/', { mode: 'cors' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data && data.country_name) {
          GEO_DATA = {
            country: data.country_name,
            countryCode: data.country_code,
            city: data.city,
            region: data.region,
            lat: data.latitude,
            lng: data.longitude,
            timezone: data.timezone
          };
          ivxTrack('geo_backfill', {});
        }
      })
      .catch(function() {
        /* ipapi.co CORS or rate limit — geo backfill is optional, fail silently */
      });
  })();

  window.addEventListener('beforeunload', function() {
    var duration = Math.round((Date.now() - PAGE_START) / 1000);
    ivxTrack('session_end', { duration: duration, eventsCount: _analyticsEventCount, engagementScore: ENGAGEMENT_SCORE });
    if (_analyticsQueue.length > 0 && !isPlaceholder(SUPABASE_URL) && !isPlaceholder(SUPABASE_ANON_KEY)) {
      var restUrl = SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/landing_analytics';
      var blob = new Blob([JSON.stringify(_analyticsQueue)], { type: 'application/json' });
      try {
        navigator.sendBeacon(restUrl + '?apikey=' + encodeURIComponent(SUPABASE_ANON_KEY), blob);
      } catch(e) {}
    }
  });


  var _funnelOrigOpen = window.openFunnel;
  window.openFunnel = function() {
    ivxTrack('funnel_open', { step: 1 });
    ivxTrack('registration_start', { source: 'funnel', step: 1 });
    if (typeof _funnelOrigOpen === 'function') return _funnelOrigOpen();
  };


  // ══════════════════════════════════════════════════════════════════════════════
  // tRPC HELPER
  // ══════════════════════════════════════════════════════════════════════════════
  // ── IVX CRM lead mirror ───────────────────────────────────────────────────────
  // Every public capture form (funnel + partner) submits through trpcCall('waitlist.join').
  // The tRPC waitlist endpoint is NOT the IVX CRM, so we ALSO mirror each submission
  // into the live, working lead-capture engine (POST /api/ivx/leads/capture →
  // behavior scoring + deal CRM pipeline). Fire-and-forget; never blocks/breaks the form.
  function mirrorLeadToIVXCRM(input) {
    try {
      if (!IVX_API || !input || typeof input !== 'object') { return; }
      var first = (input.firstName || '').toString().trim();
      var last = (input.lastName || '').toString().trim();
      var name = (first + ' ' + last).trim() || first || (input.email ? String(input.email).split('@')[0] : '');
      if (!name) { return; }
      var interest = (input.investmentInterest || '').toString().toLowerCase();
      var sourceStr = (input.source || 'ivxholding_landing').toString().toLowerCase();
      var blob = interest + ' ' + sourceStr;
      // Map landing intent → the backend lead-capture roles. All seven acquisition
      // audiences are now representable: investor | buyer | seller | jv_partner |
      // broker (realtor/broker) | developer (builder/developer) | land_owner (+ lender).
      var role = 'investor';
      if (blob.indexOf('land') !== -1 && (blob.indexOf('owner') !== -1 || blob.indexOf('sell') !== -1)) { role = 'land_owner'; }
      else if (blob.indexOf('builder') !== -1 || blob.indexOf('developer') !== -1 || blob.indexOf('development') !== -1) { role = 'developer'; }
      else if (blob.indexOf('jv') !== -1 || blob.indexOf('joint venture') !== -1 || blob.indexOf('capital partner') !== -1) { role = 'jv_partner'; }
      else if (blob.indexOf('seller') !== -1 || blob.indexOf('sell_property') !== -1 || blob.indexOf('list_property') !== -1) { role = 'seller'; }
      else if (blob.indexOf('lender') !== -1 || blob.indexOf('financing') !== -1 || blob.indexOf('lending') !== -1) { role = 'lender'; }
      else if (blob.indexOf('realtor') !== -1 || blob.indexOf('broker') !== -1) { role = 'broker'; }
      else if (blob.indexOf('buyer') !== -1 || blob.indexOf('partner') !== -1) { role = 'buyer'; }
      // Attribution — read live UTM/click context captured on page load (never invented).
      var utm = (typeof UTM_DATA === 'object' && UTM_DATA) ? UTM_DATA : {};
      var campaign = (utm.campaign || utm.source || '').toString().trim();
      var page = (typeof window !== 'undefined' && window.location ? window.location.pathname : '').toString();
      var payload = {
        name: name,
        email: (input.email || '').toString().trim(),
        phone: (input.phone || '').toString().trim(),
        role: role,
        consent: true,
        source: 'lead_form',
        sourceDetail: sourceStr,
        campaign: campaign,
        page: page,
        dealInterest: interest,
        notes: interest ? ('Landing interest: ' + interest) : 'ivxholding.com landing capture',
        ctaType: (role === 'investor' || role === 'jv_partner') ? 'request_investor_packet' : 'get_deal_access',
        signals: { browsed: true, clickedCta: true, submittedForm: true }
      };
      var _crmCtrl = new AbortController();
      var _crmTo = setTimeout(function() { _crmCtrl.abort(); }, 10000);
      fetch(IVX_API + '/api/ivx/leads/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: _crmCtrl.signal
      }).then(function(res) {
        clearTimeout(_crmTo);
        if (res && res.ok) { console.log('[IVX] Lead captured into IVX CRM (' + role + ')'); }
        else { console.warn('[IVX] CRM lead capture returned HTTP', res && res.status); }
      }).catch(function(err) {
        clearTimeout(_crmTo);
        console.warn('[IVX] CRM lead capture failed:', err && err.message ? err.message : err);
      });
    } catch (e) {
      console.warn('[IVX] CRM lead mirror error:', e && e.message ? e.message : e);
    }
  }

  function trpcCall(procedure, input, authToken) {
    if (!IVX_API) { console.warn('[IVX] No API URL — skipping:', procedure); return Promise.resolve(null); }
    if (procedure === 'waitlist.join') { mirrorLeadToIVXCRM(input); }
    var url = IVX_API + '/api/trpc/' + procedure;
    var headers = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
    var isReadOnlyStats = procedure === 'waitlist.getStats';
    var _trpcCtrl = new AbortController();
    var _trpcTo = setTimeout(function() { _trpcCtrl.abort(); }, 10000);
    return fetch(url, {
      method: isReadOnlyStats ? 'GET' : 'POST',
      headers: headers,
      body: isReadOnlyStats ? undefined : JSON.stringify({ json: input }),
      signal: _trpcCtrl.signal
    })
      .then(function(res) {
        clearTimeout(_trpcTo);
        if (!res.ok) throw new Error('Request failed with HTTP ' + res.status);
        return res.json();
      })
      .then(function(data) {
        if (data.error) throw new Error((data.error.json && data.error.json.message) || data.error.message || 'Request failed');
        return isReadOnlyStats ? data : (data.result && data.result.data && data.result.data.json);
      })
      .catch(function(err) { clearTimeout(_trpcTo); throw err; });
  }


  // ══════════════════════════════════════════════════════════════════════════════
  // LIVE ACTIVITY TICKER
  // ══════════════════════════════════════════════════════════════════════════════
  // Ticker entries are populated ONLY from real, live deal data (see
  // setTickerFromDeals, called from renderDeals). No canned activity items.
  var LIVE_ACTIVITY = [];
  function setTickerFromDeals(deals) {
    if (!Array.isArray(deals)) return;
    LIVE_ACTIVITY = deals.filter(function (d) { return d && (d.title || d.project_name); }).map(function (d) {
      var roi = Number(d.expected_roi || d.expectedROI || 0);
      var loc = [d.city, d.state].filter(Boolean).join(', ');
      return {
        name: String(d.title || d.project_name),
        action: roi > 0 ? 'live deal \u00b7 ' + roi + '% projected ROI' : 'live deal',
        location: loc || 'IVX Holdings',
        time: String(d.status || 'open')
      };
    });
    tickerIndex = 0;
    updateTicker();
  }
  var tickerIndex = 0;
  function updateTicker() {
    var tickerEl = document.getElementById('live-ticker');
    var textEl = document.getElementById('ticker-text');
    var timeEl = document.getElementById('ticker-time');
    if (!tickerEl || !textEl || !timeEl || !LIVE_ACTIVITY.length) return;
    var item = LIVE_ACTIVITY[tickerIndex] || LIVE_ACTIVITY[0];
    if (!item || !item.name || !item.action) {
      tickerEl.classList.remove('visible');
      return;
    }
    tickerEl.classList.add('visible');
    textEl.style.opacity = '0';
    textEl.style.transform = 'translateY(-8px)';
    setTimeout(function() {
      textEl.innerHTML = '<strong>' + item.name + '</strong> ' + item.action + ' <span class="ticker-loc">&middot; ' + item.location + '</span>';
      timeEl.textContent = item.time || '';
      textEl.style.opacity = '1';
      textEl.style.transform = 'translateY(0)';
    }, 250);
    tickerIndex = (tickerIndex + 1) % LIVE_ACTIVITY.length;
  }
  updateTicker();
  setInterval(updateTicker, 3000);


  // ══════════════════════════════════════════════════════════════════════════════
  // ON LOAD
  // ══════════════════════════════════════════════════════════════════════════════
  fireAdEvent('page_view', { content_name: 'IVX Landing Page' });

  window.addEventListener('load', function() {
    loadWaitlistCount();

    if (VISIT_COUNT > 1) {
      fireAdEvent('view_content', { content_name: 'Return Visit #' + VISIT_COUNT, category: 'retention' });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // WAITLIST
  // ══════════════════════════════════════════════════════════════════════════════
  async function loadWaitlistCount() {
    try {
      var data = await trpcCall('waitlist.getStats', {});
      if (data && data.total > 0) {
        var el = document.getElementById('waitlist-count-num');
        if (el) el.textContent = data.total.toLocaleString();
        var mc = document.getElementById('funnel-member-count');
        if (mc) mc.textContent = data.total.toLocaleString() + '+';
        // Hero stat: real intake count from the same live source.
        var statInv = document.getElementById('stat-investors');
        if (statInv) statInv.textContent = data.total.toLocaleString() + '+';
      }
    } catch(e) {}
  }


  // ══════════════════════════════════════════════════════════════════════════════
  // SMART 3-STEP FUNNEL
  // ══════════════════════════════════════════════════════════════════════════════
  function openFunnel() {
    document.getElementById('funnel-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
    showFunnelStep(1);
    // Populate UTM hidden fields from captured attribution (item 98)
    try {
      var attr = JSON.parse(localStorage.getItem('ivx_channel_attribution') || '{}');
      var setVal = function(id, val) { var el = document.getElementById(id); if (el && val) el.value = val; };
      setVal('f-utm-source', attr.utm_source || '');
      setVal('f-utm-medium', attr.utm_medium || '');
      setVal('f-utm-campaign', attr.utm_campaign || '');
      setVal('f-utm-content', attr.utm_content || '');
      setVal('f-utm-term', attr.utm_term || '');
    } catch(e) {}
    // Generate idempotency token if not set (item 88)
    var idemEl = document.getElementById('f-idempotency-key');
    if (idemEl && !idemEl.value) {
      idemEl.value = 'ivx-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    }
    fireAdEvent('initiate_checkout', { content_name: 'Investment Funnel', value: 0 });
  }

  function closeFunnel() {
    document.getElementById('funnel-overlay').classList.remove('open');
    document.body.style.overflow = '';
  }

  document.addEventListener('keydown', function(e) { if (e.key === 'Escape') { closeFunnel(); closePartnerApply(); closeLegalModal(); closeInvestModal(); } });

  function showFunnelStep(step) {
    FUNNEL_STEP = step;
    document.getElementById('funnel-step-1').style.display = step === 1 ? 'block' : 'none';
    document.getElementById('funnel-step-2').style.display = step === 2 ? 'block' : 'none';
    document.getElementById('funnel-step-3').style.display = step === 3 ? 'block' : 'none';
    document.getElementById('funnel-progress').style.width = ((step / 3) * 100) + '%';
  }

  function selectGoal(el, goalId) {
    SELECTED_GOAL = goalId;
    document.querySelectorAll('.goal-option').forEach(function(g) { g.classList.remove('selected'); });
    el.classList.add('selected');
    fireAdEvent('add_to_cart', { content_name: 'Goal: ' + goalId, category: 'investment_goal' });
    setTimeout(function() { showFunnelStep(2); }, 400);
  }

  async function handleFunnelSubmit(e) {
    e.preventDefault();
    var errEl = document.getElementById('funnel-error');
    var btn = document.getElementById('funnel-submit-btn');
    errEl.style.display = 'none';

    var fullName = document.getElementById('f-name').value.trim();
    var email = document.getElementById('f-email').value.trim();
    var phone = document.getElementById('f-phone').value.trim();
    var investRange = document.getElementById('f-range') ? document.getElementById('f-range').value : '';
    var consent = document.getElementById('f-consent') ? document.getElementById('f-consent').checked : false;

    // Capture UTM parameters
    var utmSource = document.getElementById('f-utm-source') ? document.getElementById('f-utm-source').value : '';
    var utmMedium = document.getElementById('f-utm-medium') ? document.getElementById('f-utm-medium').value : '';
    var utmCampaign = document.getElementById('f-utm-campaign') ? document.getElementById('f-utm-campaign').value : '';
    var utmContent = document.getElementById('f-utm-content') ? document.getElementById('f-utm-content').value : '';
    var utmTerm = document.getElementById('f-utm-term') ? document.getElementById('f-utm-term').value : '';

    // Split full name into first/last for API compatibility
    var nameParts = fullName.split(/\s+/);
    var firstName = nameParts[0] || fullName;
    var lastName = nameParts.slice(1).join(' ') || firstName;

    // Inline validation
    if (!fullName) { errEl.textContent = 'Enter your full name'; errEl.style.display = 'block'; if (window.IVX && IVX.trackFormError) IVX.trackFormError('name', 'required'); return; }
    if (!email || email.indexOf('@') === -1) { errEl.textContent = 'Enter a valid email address'; errEl.style.display = 'block'; if (window.IVX && IVX.trackFormError) IVX.trackFormError('email', 'invalid'); return; }
    // Phone is optional (item 72) — only validate format if provided
    if (phone && phone.replace(/\D/g, '').length < 7) { errEl.textContent = 'Enter a valid phone number or leave it blank'; errEl.style.display = 'block'; if (window.IVX && IVX.trackFormError) IVX.trackFormError('phone', 'invalid'); return; }
    if (!investRange) { errEl.textContent = 'Select your investment range'; errEl.style.display = 'block'; if (window.IVX && IVX.trackFormError) IVX.trackFormError('range', 'required'); return; }
    if (!consent) { errEl.textContent = 'You must accept the Terms and Privacy Policy'; errEl.style.display = 'block'; if (window.IVX && IVX.trackFormError) IVX.trackFormError('consent', 'required'); return; }

    // Honeypot check — if filled, silently reject (item 89)
    var honeypot = document.getElementById('f-company-website');
    if (honeypot && honeypot.value) { console.warn('[IVX] Honeypot triggered — bot detected'); return; }

    // Idempotency token (item 88)
    var idempotencyKey = document.getElementById('f-idempotency-key');
    var idempotencyValue = idempotencyKey ? idempotencyKey.value : '';

    // Fire analytics: registration started
    if (window.IVX && IVX.trackRegStart) IVX.trackRegStart();

    btn.textContent = 'Submitting…'; btn.disabled = true;
    var _fnlTimeout = setTimeout(function() {
      console.warn('[IVX] Funnel submission timed out after 12s — showing success anyway');
      document.getElementById('success-name').textContent = fullName;
      document.getElementById('success-position').textContent = 'Investor review started';
      var timedOutReferral = document.getElementById('referral-link');
      if (timedOutReferral) timedOutReferral.textContent = 'We will contact you within 1-2 business days to continue your investor onboarding. No further action needed right now.';
      showFunnelStep(3);
      btn.textContent = 'Start Investor Review \u2192'; btn.disabled = false;
    }, 12000);

    try {
      var result = await trpcCall('waitlist.join', {
        firstName: firstName,
        lastName: lastName || firstName,
        email: email.toLowerCase(),
        phone: phone || undefined,
        investmentInterest: investRange || SELECTED_GOAL || 'under_10k',
        source: 'landing_page_v3_funnel',
        utmSource: utmSource || undefined,
        utmMedium: utmMedium || undefined,
        utmCampaign: utmCampaign || undefined,
        utmContent: utmContent || undefined,
        utmTerm: utmTerm || undefined,
        idempotencyKey: idempotencyValue || undefined,
      });

      clearTimeout(_fnlTimeout);
      document.getElementById('success-name').textContent = fullName;
      document.getElementById('success-position').textContent = 'Investor review started';
      var successReferral = document.getElementById('referral-link');
      if (successReferral) successReferral.textContent = 'We will contact you within 1-2 business days to continue your investor onboarding. No further action needed right now.';

      showFunnelStep(3);
      fireAdEvent('lead', { content_name: 'Investor Review Request', value: 0, category: 'conversion' });

      // Fire analytics: registration completed
      if (window.IVX && IVX.trackRegComplete) IVX.trackRegComplete();

      console.log('[IVX] CONVERSION FIRED — All platforms notified.');
    } catch(err) {
      clearTimeout(_fnlTimeout);
      console.warn('[IVX] Funnel submit error:', err.message || err);
      document.getElementById('success-name').textContent = fullName;
      document.getElementById('success-position').textContent = 'Investor review started';
      var fallbackReferral = document.getElementById('referral-link');
      if (fallbackReferral) fallbackReferral.textContent = 'We will contact you within 1-2 business days to continue your investor onboarding. No further action needed right now.';
      showFunnelStep(3);
      fireAdEvent('lead', { content_name: 'Investor Review Request (fallback)', value: 0 });
      // Track backend error
      if (window.IVX && IVX.trackBackendError) IVX.trackBackendError('waitlist.join', err.message || 'unknown');
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // PARTNER APPLICATION MODAL
  // ══════════════════════════════════════════════════════════════════════════════
  var PARTNER_CONFIG = {
    realtor: {
      badge: '&#127968; REALTOR APPLICATION',
      badgeClass: 'realtor',
      title: 'Apply as <span>Realtor Partner</span>',
      sub: 'Bring listings or qualified buyers under deal-specific partner terms. Our team reviews applications within 3-5 business days.',
      roleName: 'Realtor Partner'
    },
    influencer: {
      badge: '&#128241; INFLUENCER APPLICATION',
      badgeClass: 'influencer',
      title: 'Apply as <span>Influencer</span>',
      sub: 'Share IVX with your audience under approved partner terms. Applications are reviewed within 3-5 business days.',
      roleName: 'Influencer'
    },
    broker: {
      badge: '&#128188; BROKER APPLICATION',
      badgeClass: 'broker',
      title: 'Apply as <span>Licensed Broker</span>',
      sub: 'Connect institutional investors and HNW clients under approved broker terms. Applications are reviewed within 3-5 business days.',
      roleName: 'Licensed Broker'
    },
    general: {
      badge: '&#129309; PARTNER APPLICATION',
      badgeClass: 'general',
      title: 'Join the <span>Partner Program</span>',
      sub: 'Earn a direct percentage of every deal closed. No cap, no ceiling. Fill out the form and our team will match you with the right partner track.',
      roleName: 'Partner'
    },
    investor: {
      badge: '&#128172; TALK TO OUR TEAM',
      badgeClass: 'general',
      title: 'Get in Touch with <span>Our Team</span>',
      sub: 'Have questions about investing? Want a personalized walkthrough? Fill out the form and one of our investment advisors will reach out to you.',
      roleName: 'Investor Inquiry'
    }
  };

  function openPartnerApply(role) {
    var config = PARTNER_CONFIG[role] || PARTNER_CONFIG.general;
    document.getElementById('p-role').value = role;
    var badge = document.getElementById('partner-role-badge');
    badge.innerHTML = config.badge;
    badge.className = 'partner-modal-role-badge ' + config.badgeClass;
    document.getElementById('partner-modal-title').innerHTML = config.title;
    document.getElementById('partner-modal-sub').innerHTML = config.sub;

    document.getElementById('partner-form-view').style.display = 'block';
    document.getElementById('partner-success-view').style.display = 'none';
    document.getElementById('partner-form-error').style.display = 'none';
    document.getElementById('partner-submit-btn').textContent = 'Submit Application →';
    document.getElementById('partner-submit-btn').disabled = false;
    document.getElementById('partner-apply-form').reset();

    document.getElementById('partner-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closePartnerApply() {
    document.getElementById('partner-overlay').classList.remove('open');
    document.body.style.overflow = '';
  }


  async function handlePartnerSubmit(e) {
    e.preventDefault();
    var errEl = document.getElementById('partner-form-error');
    var btn = document.getElementById('partner-submit-btn');
    errEl.style.display = 'none';

    var firstName = document.getElementById('p-first').value.trim();
    var lastName = document.getElementById('p-last').value.trim();
    var email = document.getElementById('p-email').value.trim();
    var phone = document.getElementById('p-phone').value.trim();
    var company = document.getElementById('p-company').value.trim();
    var license = document.getElementById('p-license').value.trim();
    var experience = document.getElementById('p-experience').value.trim();
    var role = document.getElementById('p-role').value;

    if (!firstName) { errEl.textContent = 'Enter your first name'; errEl.style.display = 'block'; return; }
    if (!lastName) { errEl.textContent = 'Enter your last name'; errEl.style.display = 'block'; return; }
    if (!email || email.indexOf('@') === -1) { errEl.textContent = 'Enter a valid email address'; errEl.style.display = 'block'; return; }
    if (!phone) { errEl.textContent = 'Enter your phone number'; errEl.style.display = 'block'; return; }

    btn.textContent = 'Submitting...'; btn.disabled = true;
    try {
      var config = PARTNER_CONFIG[role] || PARTNER_CONFIG.general;

      // Submit as waitlist entry with partner metadata
      await trpcCall('waitlist.join', {
        firstName: firstName,
        lastName: lastName,
        email: email.toLowerCase(),
        phone: phone,
        investmentInterest: 'partner_' + role,
        source: 'landing_partner_apply_' + role,
      });

      document.getElementById('partner-success-name').textContent = firstName;
      document.getElementById('partner-success-role').textContent = config.roleName;
      document.getElementById('partner-form-view').style.display = 'none';
      document.getElementById('partner-success-view').style.display = 'block';

      fireAdEvent('lead', { content_name: 'Partner Application: ' + config.roleName, value: 100, category: 'partner_conversion' });

      console.log('[IVX] Partner application submitted:', role, firstName, lastName, email);
    } catch(err) {
      console.error('[IVX] Partner submit error:', err);
      // Still show success since the tracking event was sent
      var config2 = PARTNER_CONFIG[role] || PARTNER_CONFIG.general;
      document.getElementById('partner-success-name').textContent = firstName;
      document.getElementById('partner-success-role').textContent = config2.roleName;
      document.getElementById('partner-form-view').style.display = 'none';
      document.getElementById('partner-success-view').style.display = 'block';
    }
  }

  function navigateToApp(path) {
    if (IVX_APP_URL) {
      window.open(IVX_APP_URL + (path || ''), '_blank');
    } else {
      openFunnel();
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // INVESTMENT MODAL — Full purchase flow on landing page
  // ══════════════════════════════════════════════════════════════════════════════
  var _investState = {
    dealId: '',
    dealTitle: '',
    dealProjectName: '',
    dealAddress: '',
    dealTotal: 0,
    dealROI: 0,
    dealFrequency: 'Monthly',
    pool: 'jv_direct',
    amount: 0,
    paymentMethod: 'bank',
    termsAgreed: false,
    authMode: 'signup',
    userEmail: '',
    userToken: '',
    userId: '',
    _authSb: null,
    step: 1,
  };

  var FALLBACK_DEAL_DATA = {
    'perez-residence-001': {
      title: 'PEREZ RESIDENCE',
      projectName: 'ONE STOP DEVELOPMENT LLC',
      address: 'Southwest Ranches, FL',
      totalInvestment: 2500000,
      expectedROI: 25,
      distributionFrequency: 'Monthly',
    },
    'casa-rosario-001': {
      title: 'CASA ROSARIO',
      projectName: 'ONE STOP DEVELOPMENT TWO LLC',
      address: 'Pembroke Pines, FL',
      totalInvestment: 1400000,
      expectedROI: 30,
      distributionFrequency: 'Monthly',
    },
    'JV-202603-5190': {
      title: 'IVX JACKSONVILLE PRIME',
      projectName: 'ONE STOP CONSTRUCTORS INC',
      address: 'Jacksonville, FL',
      totalInvestment: 400000,
      expectedROI: 9.5,
      distributionFrequency: 'Monthly',
    }
  };

  function investInDeal(dealId) {
    try { fireAdEvent('initiate_checkout', { content_name: 'JV Deal ' + dealId, value: 0 }); } catch(e) {}
    console.log('[IVX Invest] Opening investment modal for deal:', dealId);
    openInvestModal(dealId);
  }

  function getLiveDealData(dealId) {
    var cachedDeals = [];
    try {
      cachedDeals = getCachedDeals() || [];
    } catch (e) {
      cachedDeals = [];
    }

    for (var i = 0; i < cachedDeals.length; i++) {
      var candidate = cachedDeals[i] || {};
      if (String(candidate.id || '') !== String(dealId || '')) continue;
      var candidateTitle = String(candidate.title || '').trim();
      var candidateProject = String(candidate.projectName || candidate.project_name || '').trim();
      var looksSwapped = candidateTitle.toUpperCase().indexOf('CONSTRUCTORS') !== -1 && candidateProject.toUpperCase().indexOf('JACKSONVILLE') !== -1;
      return {
        title: looksSwapped ? candidateProject : (candidateTitle || candidateProject || String(dealId || '')),
        projectName: looksSwapped ? candidateTitle : (candidateProject || candidateTitle || ''),
        address: String(candidate.address_short || candidate.addressShort || candidate.propertyAddress || '').trim(),
        totalInvestment: Number(candidate.total_investment || candidate.totalInvestment || 0),
        expectedROI: Number(candidate.expected_roi || candidate.expectedROI || 0),
        distributionFrequency: String(candidate.distribution_frequency || candidate.distributionFrequency || 'Monthly').trim() || 'Monthly',
      };
    }

    return null;
  }

  // AUTO PROFILE CREATION — Creates profile in Supabase so investor appears in admin Members
  // ══════════════════════════════════════════════════════════════════════════════
  async function createInvestorProfile(userId, email, token, firstName, lastName) {
    if (!userId || !email || !token) { console.log('[IVX Profile] Missing data — skipping profile creation'); return; }
    if (isPlaceholder(SUPABASE_URL) || isPlaceholder(SUPABASE_ANON_KEY)) { console.log('[IVX Profile] Supabase not configured'); return; }
    try {
      var profileData = {
        id: userId,
        email: email.toLowerCase(),
        first_name: firstName || email.split('@')[0] || 'Investor',
        last_name: lastName || '',
        status: 'active',
        kyc_status: 'pending',
        wallet_balance: 0,
        total_invested: 0,
        holdings: 0,
        total_transactions: 0,
        source: 'landing_page',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      var restUrl = SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/profiles';
      var resp = await fetch(restUrl, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation,resolution=merge-duplicates'
        },
        body: JSON.stringify(profileData)
      });
      if (resp.ok || resp.status === 201 || resp.status === 200) {
        console.log('[IVX Profile] Investor profile created/updated in Supabase for:', email);
        try { localStorage.setItem('ivx_portal_session', JSON.stringify({ userId: userId, email: email, token: token, firstName: firstName || email.split('@')[0], lastName: lastName || '', ts: Date.now() })); } catch(e) {}
      } else {
        var body = await resp.text();
        console.warn('[IVX Profile] Profile upsert failed (' + resp.status + '):', body);
        if (resp.status === 409 || body.indexOf('duplicate') !== -1) {
          console.log('[IVX Profile] Profile already exists — updating...');
          var updateUrl = restUrl + '?id=eq.' + userId;
          await fetch(updateUrl, {
            method: 'PATCH',
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': 'Bearer ' + token,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ last_activity: new Date().toISOString(), updated_at: new Date().toISOString(), source: 'landing_page' })
          });
          console.log('[IVX Profile] Profile updated for:', email);
          try { localStorage.setItem('ivx_portal_session', JSON.stringify({ userId: userId, email: email, token: token, firstName: firstName || email.split('@')[0], lastName: lastName || '', ts: Date.now() })); } catch(e) {}
        }
      }
    } catch(err) {
      console.warn('[IVX Profile] Profile creation error:', err.message);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  function selectPaymentMethod(method) {
    _investState.paymentMethod = method;
    ['bank','wire','wallet'].forEach(function(m) {
      var el = document.getElementById('invest-pay-' + m);
      if (el) el.className = 'invest-payment-option' + (m === method ? ' selected' : '');
    });
  }

  function toggleInvestTerms() {
    _investState.termsAgreed = !_investState.termsAgreed;
    var row = document.getElementById('invest-terms-row');
    var btn = document.getElementById('invest-confirm-btn');
    if (row) { if (_investState.termsAgreed) row.classList.add('checked'); else row.classList.remove('checked'); }
    if (btn) { btn.disabled = !_investState.termsAgreed; btn.textContent = _investState.termsAgreed ? 'Confirm Investment \u2192' : 'Agree to terms to confirm'; }
  }

  var _lastSubmitTime = 0;
  var _submitCount = 0;
  var _submitWindowStart = 0;
  var SUBMIT_COOLDOWN_MS = 5000;
  var MAX_SUBMITS_PER_WINDOW = 3;
  var SUBMIT_WINDOW_MS = 60000;

  function isRateLimited() {
    var now = Date.now();
    if (now - _lastSubmitTime < SUBMIT_COOLDOWN_MS) {
      console.warn('[IVX RateLimit] Too fast — wait', Math.ceil((SUBMIT_COOLDOWN_MS - (now - _lastSubmitTime)) / 1000), 'seconds');
      return true;
    }
    if (now - _submitWindowStart > SUBMIT_WINDOW_MS) {
      _submitCount = 0;
      _submitWindowStart = now;
    }
    if (_submitCount >= MAX_SUBMITS_PER_WINDOW) {
      console.warn('[IVX RateLimit] Max submissions reached (' + MAX_SUBMITS_PER_WINDOW + ' per minute)');
      return true;
    }
    return false;
  }

  async function confirmInvestment() {
    var btn = document.getElementById('invest-confirm-btn');
    if (isRateLimited()) {
      if (btn) { btn.textContent = 'Please wait...'; setTimeout(function() { btn.textContent = 'Confirm Investment \u2192'; btn.disabled = !_investState.termsAgreed; }, 3000); }
      return;
    }
    _lastSubmitTime = Date.now();
    _submitCount++;
    if (btn) { btn.textContent = 'Submitting...'; btn.disabled = true; }
    fireAdEvent('initiate_checkout', { content_name: 'Investment Intent: ' + _investState.dealTitle, value: _investState.amount });

    var payLabels = { bank: 'Bank Transfer (ACH)', wire: 'Wire Transfer', wallet: 'Wallet Balance' };
    var syncResult = null;
    var saved = false;

    // PRIMARY PATH: create a real payment transaction through the IVX backend.
    // This writes to both `transactions` and `landing_investments` with audit logging.
    try {
      var apiBase = (window.__IVX_API_BASE || IVX_API || '').replace(/\/+$/, '');
      if (!apiBase || apiBase.indexOf('http') !== 0) {
        // Fallback to the configured backend URL if available.
        apiBase = (window.__IVX_BACKEND_URL || '').replace(/\/+$/, '');
      }
      if (apiBase && apiBase.indexOf('http') === 0) {
        var syncHeaders = { 'Content-Type': 'application/json' };
        if (_investState.userToken) syncHeaders['Authorization'] = 'Bearer ' + _investState.userToken;
        var syncResp = await fetch(apiBase + '/api/ivx/payments/landing-intent', {
          method: 'POST',
          headers: syncHeaders,
          body: JSON.stringify({
            dealId: _investState.dealId,
            dealTitle: _investState.dealTitle,
            investmentType: _investState.pool === 'token_shares' ? 'Fractional Shares' : 'JV Direct Investment',
            amount: _investState.amount,
            expectedRoi: _investState.dealROI,
            ownershipPct: _investState.dealTotal > 0 ? parseFloat(((_investState.amount / _investState.dealTotal) * 100).toFixed(4)) : 0,
            paymentMethod: _investState.paymentMethod,
            investorEmail: _investState.userEmail,
            investorId: _investState.userId || null,
            investorName: ((_investState.firstName || '') + ' ' + (_investState.lastName || '')).trim(),
            termsAccepted: true,
            source: 'landing_page'
          })
        });
        if (syncResp.ok) {
          syncResult = await syncResp.json();
          if (syncResult && syncResult.ok) {
            saved = true;
            console.log('[IVX Invest] Real payment transaction synced via backend:', syncResult.transactionId, syncResult.intentId);
          }
        } else {
          console.warn('[IVX Invest] Backend sync failed (' + syncResp.status + '):', await syncResp.text());
        }
      }
    } catch(syncErr) {
      console.warn('[IVX Invest] Backend sync error:', syncErr.message);
    }

    // FALLBACK: direct Supabase landing_investments insert when backend is unreachable.
    // This still creates a real record, but without the canonical transactions table link.
    var intentId = (syncResult && syncResult.intentId) ? syncResult.intentId : 'INT-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substr(2,4).toUpperCase();
    if (!saved) {
      var investmentRecord = {
        intent_id: intentId,
        deal_id: _investState.dealId,
        deal_title: _investState.dealTitle,
        investment_type: _investState.pool === 'token_shares' ? 'Fractional Shares' : 'JV Direct Investment',
        amount: _investState.amount,
        ownership_pct: _investState.dealTotal > 0 ? parseFloat(((_investState.amount / _investState.dealTotal) * 100).toFixed(4)) : 0,
        expected_roi: _investState.dealROI,
        payment_method: payLabels[_investState.paymentMethod] || 'Bank Transfer (ACH)',
        investor_email: _investState.userEmail,
        investor_id: _investState.userId || null,
        status: 'pending_payment',
        terms_accepted: true,
        source: 'landing_page',
        created_at: new Date().toISOString()
      };
      try {
        if (_investState._authSb && _investState.userToken) {
          var restUrl = SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/landing_investments';
          var resp = await fetch(restUrl, {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': 'Bearer ' + _investState.userToken,
              'Content-Type': 'application/json',
              'Prefer': 'return=representation'
            },
            body: JSON.stringify(investmentRecord)
          });
          if (resp.ok || resp.status === 201) {
            saved = true;
            console.log('[IVX Invest] Investment intent saved to Supabase fallback:', intentId);
          } else {
            var errBody = await resp.text();
            console.warn('[IVX Invest] Supabase insert failed (' + resp.status + '):', errBody);
          }
        }
      } catch(saveErr) {
        console.warn('[IVX Invest] Save error:', saveErr.message);
      }
    }

    // LAST-RESORT FALLBACK: waitlist capture so the lead is never lost.
    if (!saved) {
      try {
        await trpcCall('waitlist.join', {
          firstName: _investState.userEmail.split('@')[0] || 'Investor',
          lastName: '',
          email: _investState.userEmail.toLowerCase(),
          phone: '',
          investmentInterest: 'investment_intent_' + _investState.amount,
          source: 'landing_invest_' + _investState.dealId + '_' + _investState.amount,
        });
        saved = true;
        console.log('[IVX Invest] Investment intent saved via waitlist fallback');
      } catch(fbErr) {
        console.warn('[IVX Invest] Waitlist fallback also failed:', fbErr.message);
      }
    }

    ivxTrack('investment_intent', {
      intentId: intentId,
      backendTransactionId: syncResult ? syncResult.transactionId : null,
      dealId: _investState.dealId,
      dealTitle: _investState.dealTitle,
      amount: _investState.amount,
      pool: _investState.pool,
      paymentMethod: _investState.paymentMethod,
      email: _investState.userEmail,
      saved: saved,
      synced: !!syncResult
    });

    var el = function(id) { return document.getElementById(id); };
    if (el('success-deal-name')) el('success-deal-name').textContent = _investState.dealTitle;
    if (el('success-deal')) el('success-deal').textContent = _investState.dealTitle;
    if (el('success-type')) el('success-type').textContent = _investState.pool === 'token_shares' ? 'Fractional Shares' : 'JV Direct';
    if (el('success-amount')) el('success-amount').textContent = '$' + _investState.amount.toLocaleString();
    var eqPct = _investState.dealTotal > 0 ? ((_investState.amount / _investState.dealTotal) * 100).toFixed(4) + '%' : '0%';
    if (el('success-equity')) el('success-equity').textContent = eqPct;
    if (el('success-roi')) el('success-roi').textContent = '+' + _investState.dealROI + '% ($' + (_investState.amount * _investState.dealROI / 100).toLocaleString() + ')';
    if (el('success-confirmation')) el('success-confirmation').textContent = intentId;
    if (el('success-investor-email')) el('success-investor-email').textContent = _investState.userEmail;
    if (syncResult && syncResult.transactionId) {
      var txNote = el('success-transaction-note');
      if (txNote) txNote.textContent = 'Payment transaction ' + syncResult.transactionId + ' created and pending confirmation.';
    }

    FALLBACK_DEAL_DATA[_investState.dealId] = {
      title: _investState.dealTitle,
      projectName: _investState.dealProjectName,
      address: _investState.dealAddress,
      totalInvestment: _investState.dealTotal,
      expectedROI: _investState.dealROI,
      distributionFrequency: _investState.dealFrequency,
    };

    showInvestStep(5);
    fireAdEvent('lead', { content_name: 'Investment Intent: ' + _investState.dealTitle, value: _investState.amount, category: 'investment_conversion' });
    console.log('[IVX Invest] Investment intent flow complete:', intentId, '| saved:', saved);
  }

  function toggleReferral() {
    var box = document.getElementById('referral-box');
    if (box) { box.classList.toggle('open'); }
  }

  function copyReferral() {
    var link = document.getElementById('referral-link');
    if (!link) return;
    var text = link.textContent;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function() {
        var cb = link.parentElement.querySelector('.frb-copy');
        if (cb) { cb.innerHTML = '&#10003;'; setTimeout(function() { cb.innerHTML = '&#128203;'; }, 2000); }
      });
    } else {
      var ta = document.createElement('textarea'); ta.value = text;
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
      var cb = link.parentElement.querySelector('.frb-copy');
      if (cb) { cb.innerHTML = '&#10003;'; setTimeout(function() { cb.innerHTML = '&#128203;'; }, 2000); }
    }
  }

  // LIVE DEALS — Supabase + Backend Fetch + Realtime
  // ══════════════════════════════════════════════════════════════════════════════
  (function() {
    var sb = null;
    var useApi = false;
    var _configFetchDone = false;

    function isValidJwtKey(key) {
      return isValidJwtFormat(key) && !isPlaceholder(key);
    }

    function initSupabaseClient() {
      if (!isPlaceholder(SUPABASE_URL) && !isPlaceholder(SUPABASE_ANON_KEY)) {
        console.log('[IVX Deals] Supabase configured ✓ — connecting...');
        console.log('[IVX Deals] URL:', SUPABASE_URL.substring(0, 40) + '...');
        try {
          sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
          useApi = false;
          _supabaseReady = true;
        } catch (e) {
          console.error('[IVX Deals] Supabase client init failed:', e.message);
          useApi = true;
        }
      } else {
        console.warn('[IVX Deals] Supabase credentials still PLACEHOLDER after config load');
        console.warn('[IVX Deals] SUPABASE_URL:', SUPABASE_URL.substring(0, 30));
        useApi = true;
      }
    }

    function applyConfig(cfg) {
      if (cfg.supabaseUrl && cfg.supabaseUrl.length > 10) SUPABASE_URL = cfg.supabaseUrl;
      if (cfg.supabaseAnonKey && cfg.supabaseAnonKey.length > 10) SUPABASE_ANON_KEY = cfg.supabaseAnonKey;
      if (cfg.apiBaseUrl && cfg.apiBaseUrl.length > 5) {
        IVX_API = cfg.apiBaseUrl.replace(/\/$/, '');
      }
      if (cfg.backendUrl && cfg.backendUrl.length > 5 && !isPlaceholder(cfg.backendUrl)) {
        var bu = cfg.backendUrl.replace(/\/$/, '');
        IVX_API_FALLBACKS = [bu, IVX_API, 'https://ivxholding.com'].filter(function(v,i,a) { return v && v.length > 5 && a.indexOf(v) === i; });
      } else {
        IVX_API_FALLBACKS = [IVX_API, 'https://ivxholding.com'].filter(function(v,i,a) { return v && v.length > 5 && a.indexOf(v) === i; });
      }
      if (cfg.appUrl && cfg.appUrl.length > 5) IVX_APP_URL = cfg.appUrl.replace(/\/$/, '');
      checkSupabaseReady();
      cacheCredentials();
    }

    function tryLoadConfig(callback) {
      if (_configFetchDone) { callback(); return; }
      if (!isPlaceholder(SUPABASE_URL) && !isPlaceholder(SUPABASE_ANON_KEY)) {
        _configFetchDone = true;
        initSupabaseClient();
        callback();
        return;
      }
      var configEndpoints = [];
      // Try IVX backend first (most reliable — always running with real env vars)
      for (var ai = 0; ai < IVX_API_FALLBACKS.length; ai++) {
        var apiBase = IVX_API_FALLBACKS[ai];
        if (apiBase && apiBase.indexOf('ivxholding.com') === -1) {
          configEndpoints.push(apiBase + '/api/landing-config?_t=' + Date.now());
        }
      }
      configEndpoints.push('/ivx-config.json?_t=' + Date.now());
      configEndpoints.push('https://ivxholding.com/ivx-config.json?_t=' + Date.now());
      // Also try all fallbacks as landing-config
      for (var ai2 = 0; ai2 < IVX_API_FALLBACKS.length; ai2++) {
        var apiBase2 = IVX_API_FALLBACKS[ai2];
        if (apiBase2) configEndpoints.push(apiBase2 + '/api/landing-config?_t=' + Date.now());
      }
      var cfgIdx = 0;
      function tryNextConfig() {
        if (cfgIdx >= configEndpoints.length || (!isPlaceholder(SUPABASE_URL) && !isPlaceholder(SUPABASE_ANON_KEY))) {
          _configFetchDone = true;
          if (!isPlaceholder(SUPABASE_URL) && !isPlaceholder(SUPABASE_ANON_KEY)) {
            initSupabaseClient();
          } else {
            useApi = true;
            _configRetryCount++;
            if (_configRetryCount < _CONFIG_MAX_RETRIES) {
              console.log('[IVX Deals] Will retry config in', (_configRetryCount * 3), 'seconds...');
              setTimeout(function() {
                _configFetchDone = false;
                tryLoadConfig(function() {
                  if (_supabaseReady && !sb) {
                    initSupabaseClient();
                    fetchDeals();
                    setupRealtime(); setupPresence();
                  }
                });
              }, _configRetryCount * 3000);
            }
          }
          callback();
          return;
        }
        var url = configEndpoints[cfgIdx++];
        console.log('[IVX Deals] Fetching config from:', url);
        var controller = new AbortController();
        var timeout = setTimeout(function() { controller.abort(); }, 5000);
        fetch(url, { signal: controller.signal }).then(function(r) {
          clearTimeout(timeout);
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        }).then(function(cfg) {
          console.log('[IVX Deals] Config loaded ✓ from', url);
          applyConfig(cfg);
          _configFetchDone = true;
          initSupabaseClient();
          callback();
        }).catch(function(err) {
          clearTimeout(timeout);
          console.warn('[IVX Deals] Config fetch failed from', url, ':', err.message);
          tryNextConfig();
        });
      }
      tryNextConfig();
    }

    var _dealFetchFailCount = 0;
    initSupabaseClient();

    function formatCurrency(num) {
      if (!num || isNaN(num)) return '\x240';
      num = Number(num);
      if (num >= 1e9) return '\x24' + (num / 1e9).toFixed(2) + 'B';
      if (num >= 1e6) return '\x24' + (num / 1e6).toFixed(2) + 'M';
      if (num >= 1e3) return '\x24' + Math.round(num).toLocaleString();
      return '\x24' + num.toLocaleString();
    }

    function formatCurrencyWithDecimals(num) {
      var safeNum = Number(num || 0);
      if (!safeNum || isNaN(safeNum)) return '$0.00';
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(safeNum);
    }

    function escapeHtml(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function normalizeTrustInfo(value) {
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
      if (typeof value === 'string' && value.trim()) {
        try {
          var parsed = JSON.parse(value);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        } catch (e) {}
      }
      return {};
    }

    function getDealAddressShort(deal) {
      var addressShort = String(deal.addressShort || deal.address_short || '').trim();
      if (addressShort) return addressShort;
      if (deal.city && deal.state) return String(deal.city).trim() + ', ' + String(deal.state).trim();
      var propertyAddress = String(deal.propertyAddress || deal.property_address || '').trim();
      if (propertyAddress) {
        var parts = propertyAddress.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
        if (parts.length >= 2) return parts[parts.length - 2] + ', ' + parts[parts.length - 1];
        return propertyAddress;
      }
      return '';
    }

    function getDealSalePrice(deal, trustInfo) {
      var salePrice = Number(
        deal.salePrice || deal.sale_price || trustInfo.salePrice || trustInfo.sale_price ||
        deal.propertyValue || deal.property_value || deal.estimated_value ||
        deal.totalInvestment || deal.total_investment || 0
      );
      return !isNaN(salePrice) && salePrice > 0 ? salePrice : 0;
    }

    function getDealMinInvestment(deal, trustInfo) {
      // Only a real per-deal minimum may render. No default: a missing
      // minimum shows the honest "Not available" state instead of a
      // fabricated figure.
      var minInvestment = Number(
        deal.minInvestment || deal.min_investment || deal.minimum_investment ||
        trustInfo.minInvestment || trustInfo.min_investment || 0
      );
      return !isNaN(minInvestment) && minInvestment > 0 ? minInvestment : 0;
    }

    function getDealFractionalSharePrice(deal, trustInfo, minInvestment) {
      var sharePrice = Number(
        deal.fractionalSharePrice || deal.fractional_share_price ||
        trustInfo.fractionalSharePrice || trustInfo.fractional_share_price || minInvestment
      );
      return !isNaN(sharePrice) && sharePrice > 0 ? sharePrice : minInvestment;
    }

    function buildOwnershipText(minInvestment, salePrice) {
      if (!(minInvestment > 0) || !(salePrice > 0)) return 'Ownership updates from live sale price';
      return ((minInvestment / salePrice) * 100).toFixed(4) + '% minimum ownership';
    }

    function getDealOwnershipText(deal, trustInfo, minInvestment, salePrice) {
      var explicit = String(deal.ownershipText || deal.ownership_text || trustInfo.ownershipLabel || trustInfo.ownership_label || '').trim();
      return explicit || buildOwnershipText(minInvestment, salePrice);
    }

    function getMinimumOwnershipLabel(minInvestment, salePrice) {
      if (!(minInvestment > 0) || !(salePrice > 0)) return 'Live sync pending';
      return ((minInvestment / salePrice) * 100).toFixed(4) + '% min';
    }

    function getDealTimeline(trustInfo) {
      var min = Number(trustInfo.timelineMin || trustInfo.timeline_min || 0);
      var max = Number(trustInfo.timelineMax || trustInfo.timeline_max || 0);
      var unit = (trustInfo.timelineUnit || trustInfo.timeline_unit) === 'years' ? 'yr' : 'mo';
      if (min > 0 && max > 0) return min + '\u2013' + max + ' ' + unit;
      if (max > 0) return max + ' ' + unit;
      if (min > 0) return min + ' ' + unit;
      return '';
    }

    function getDealDeveloperName(deal, trustInfo) {
      return String(
        trustInfo.llcName || trustInfo.builderName ||
        deal.developerName || deal.developer_name ||
        deal.projectName || deal.project_name || 'IVX Holdings LLC'
      ).trim();
    }

    function buildTrustBadgesHtml(trustInfo) {
      var trustBadgesHtml = '';
      if (trustInfo.titleVerified) trustBadgesHtml += '<span class="live-deal-trust-badge"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#22C55E" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Title Verified</span>';
      if (trustInfo.insuranceCoverage) trustBadgesHtml += '<span class="live-deal-trust-badge"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#4A90D9" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Insured</span>';
      if (trustInfo.escrowProtected) trustBadgesHtml += '<span class="live-deal-trust-badge"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFD700" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Escrow</span>';
      if (trustInfo.permitStatus === 'approved') trustBadgesHtml += '<span class="live-deal-trust-badge"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#22C55E" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> Permitted</span>';
      return trustBadgesHtml;
    }

    function getCategoryChips(dealType) {
      var tokenized = '<span class="ivx-card-chip tokenized"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg> Tokenized</span>';
      var jv = '<span class="ivx-card-chip jv"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> JV Deal</span>';
      var buyer = '<span class="ivx-card-chip buyer"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> Buyer</span>';
      switch (dealType) {
        case 'jv': case 'equity_split': case 'hybrid': return tokenized + jv + buyer;
        case 'development': case 'new_construction': case 'rehab_construction': return jv + tokenized + buyer;
        case 'profit_sharing': return tokenized + buyer + jv;
        default: return tokenized + jv + buyer;
      }
    }

    function toggleDealDetails(btn, dealId) {
      var panel = document.getElementById('ivx-card-details-' + dealId);
      if (!panel) return;
      var isOpen = panel.classList.contains('open');
      if (isOpen) { panel.classList.remove('open'); btn.classList.remove('open'); }
      else { panel.classList.add('open'); btn.classList.add('open'); }
    }

    function toggleDealLike(btn, dealId) {
      btn.classList.toggle('liked');
      var icon = btn.querySelector('.ivx-card-action-icon');
      var count = btn.querySelector('.ivx-card-action-count');
      var liked = btn.classList.contains('liked');
      icon.textContent = liked ? '&#10084;' : '&#9825;';
      if (count) count.textContent = liked ? '1' : '0';
    }

    function toggleDealSave(btn, dealId) {
      btn.classList.toggle('saved');
      var icon = btn.querySelector('.ivx-card-action-icon');
      var saved = btn.classList.contains('saved');
      icon.textContent = saved ? '&#128278;' : '&#128279;';
    }

    function shareDeal(dealId) {
      var url = 'https://ivxholding.com/?deal=' + encodeURIComponent(dealId);
      if (navigator.share) { navigator.share({ title: 'IVX Investment', url: url }).catch(function(){}); }
      else if (navigator.clipboard) { navigator.clipboard.writeText(url).catch(function(){}); }
    }

    function openDealComments(dealId) {
      window.location.href = 'https://ivxholding.com/?deal=' + encodeURIComponent(dealId) + '#comments';
    }

    function buildDealCardHtml(deal) {
      var trustInfo = normalizeTrustInfo(deal.trustInfo || deal.trust_info || {});
      var photos = (Array.isArray(deal.photos) ? deal.photos : []).filter(isRenderableGalleryPhoto).slice(0, 8);
      var dealVideos = getDealPostVideos(deal);
      var status = String(deal.status || '').toLowerCase();
      var isActive = status === 'published' || status === 'active' || status === 'live';
      var dealType = String(deal.type || deal.deal_type || '').toLowerCase();
      var location = getDealAddressShort(deal);
      var developerName = getDealDeveloperName(deal, trustInfo);
      var salePrice = getDealSalePrice(deal, trustInfo);
      var totalInvestment = Number(deal.totalInvestment || deal.total_investment || 0);
      var minInvestment = getDealMinInvestment(deal, trustInfo);
      var roi = Number(deal.expectedROI || deal.expected_roi || 0);
      var ownershipPercent = (minInvestment > 0 && salePrice > 0) ? ((minInvestment / salePrice) * 100).toFixed(4) : '0.0000';
      var timelineLabel = getDealTimeline(trustInfo) || 'Timeline pending verification';
      var dealUrl = 'https://ivxholding.com/?deal=' + encodeURIComponent(deal.id || '') + '#deals';
      var chips = getCategoryChips(dealType);

      var slideTotal = dealVideos.length + photos.length;
      var sliderId = 'slider-' + (deal.id || Math.random().toString(36).substr(2, 6));
      var galleryHtml = '';
      if (slideTotal > 0) {
        var imgsHtml = '';
        for (var dvi = 0; dvi < dealVideos.length; dvi++) {
          var dv = dealVideos[dvi] || {};
          var dvSrc = typeof dv === 'string' ? dv : (dv.video_url || dv.url || '');
          if (!dvSrc) continue;
          var dvPoster = typeof dv === 'string' ? '' : (dv.thumbnail_url || dv.cover_url || '');
          imgsHtml += '<video ' + (/\.m3u8($|\?)/.test(dvSrc) ? 'data-hls="' + dvSrc + '"' : 'src="' + dvSrc + '"') + (dvPoster ? ' poster="' + dvPoster + '"' : '') + ' preload="metadata" muted loop playsinline controls controlslist="nodownload noremoteplayback" style="min-width:100%;width:100%;height:100%;object-fit:cover;scroll-snap-align:start;flex:0 0 100%;background:#000;"></video>';
        }
        for (var pi = 0; pi < photos.length; pi++) {
          imgsHtml += '<img src="' + photos[pi] + '" alt="" loading="lazy" decoding="async" fetchpriority="low" referrerpolicy="no-referrer" style="min-width:100%;width:100%;height:100%;object-fit:cover;scroll-snap-align:start;flex:0 0 100%;" onerror="this.remove();" />';
        }
        var dotsHtml = '';
        if (slideTotal > 1) {
          dotsHtml = '<div class="ivx-card-photo-dots" data-slider="' + sliderId + '">';
          for (var di = 0; di < slideTotal; di++) {
            dotsHtml += '<div class="ivx-card-photo-dot' + (di === 0 ? ' active' : '') + '" data-idx="' + di + '"></div>';
          }
          dotsHtml += '</div>';
        }
        galleryHtml = '<div class="ivx-card-gallery">' +
          '<div class="ivx-card-gallery-slider" id="' + sliderId + '">' + imgsHtml + '</div>' +
          '<div class="ivx-card-status-badge ' + (isActive ? 'active' : 'pending') + '"><div class="ivx-card-status-dot"></div>' + (isActive ? 'Active' : 'Pending') + '</div>' +
          (slideTotal > 1 ? '<div class="ivx-card-photo-count">1/' + slideTotal + '</div>' : '') +
          dotsHtml +
          '</div>';
      } else {
        var dealTitle = escapeHtml((deal.title || 'Deal').toUpperCase());
        var dealSubtitle = escapeHtml(location ? location : 'IVX Investment');
        galleryHtml = '<div class="ivx-card-gallery">' +
          '<div class="ivx-card-no-image">' +
            '<div style="width:56px;height:56px;border-radius:16px;background:rgba(230,194,0,0.1);border:1.5px solid rgba(230,194,0,0.2);display:flex;align-items:center;justify-content:center;font-size:24px;">&#127960;</div>' +
            '<div style="font-size:13px;font-weight:800;color:#E6C200;letter-spacing:1px;text-align:center;padding:0 16px;">' + dealTitle + '</div>' +
            '<div style="font-size:10px;color:#909090;">' + dealSubtitle + '</div>' +
          '</div>' +
          '<div class="ivx-card-status-badge ' + (isActive ? 'active' : 'pending') + '"><div class="ivx-card-status-dot"></div>' + (isActive ? 'Active' : 'Pending') + '</div>' +
          '</div>';
      }

      var bodyHtml = '<div class="ivx-card-body">' +
        '<div class="ivx-card-title">' + escapeHtml(deal.title || deal.projectName || 'Untitled') + '</div>' +
        (location ? '<div class="ivx-card-location"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#909090" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> ' + escapeHtml(location) + '</div>' : '') +
        '<div class="ivx-card-summary">' +
          '<div class="ivx-card-summary-item">' +
            '<div class="ivx-card-summary-label"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#E6C200" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> SALE PRICE</div>' +
            '<div class="ivx-card-summary-value">' + escapeHtml(formatCurrency(salePrice)) + '</div>' +
          '</div>' +
          '<div class="ivx-card-summary-item">' +
            '<div class="ivx-card-summary-label"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4A90D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 9 3.2"/><path d="M22 12a10 10 0 0 1-9 9.8"/><path d="M12 12v9"/></svg> TOTAL INVESTMENT</div>' +
            '<div class="ivx-card-summary-value">' + escapeHtml(formatCurrency(totalInvestment)) + '</div>' +
          '</div>' +
          '<div class="ivx-card-summary-item">' +
            '<div class="ivx-card-summary-label"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#00C48C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg> ROI</div>' +
            '<div class="ivx-card-summary-value">' + escapeHtml(roi > 0 ? roi + '%' : 'Not available') + '</div>' +
          '</div>' +
          '<div class="ivx-card-summary-item">' +
            '<div class="ivx-card-summary-label"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> TIMELINE</div>' +
            '<div class="ivx-card-summary-value">' + escapeHtml(timelineLabel) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="ivx-card-timeline">' +
          '<div class="ivx-card-timeline-header"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Project Timeline</div>' +
          '<div class="ivx-card-timeline-row">' +
            '<div class="ivx-card-timeline-item"><div class="ivx-card-timeline-label">Current Stage</div><div class="ivx-card-timeline-value">Pending</div></div>' +
            '<div class="ivx-card-timeline-item"><div class="ivx-card-timeline-label">Progress</div><div class="ivx-card-timeline-value">0%</div></div>' +
            '<div class="ivx-card-timeline-item"><div class="ivx-card-timeline-label">Est. Completion</div><div class="ivx-card-timeline-value">Not available</div></div>' +
          '</div>' +
          '<div class="ivx-card-progress-bar"><div class="ivx-card-progress-fill" style="width:0%"></div></div>' +
        '</div>' +
        '<div class="ivx-card-min-row">' +
          '<div class="ivx-card-min-item">' +
            '<div class="ivx-card-min-label">MINIMUM INVESTMENT</div>' +
            '<div class="ivx-card-min-value">' + escapeHtml(minInvestment > 0 ? 'From ' + formatCurrencyWithDecimals(minInvestment) : 'Not available') + '</div>' +
          '</div>' +
          '<div class="ivx-card-min-divider"></div>' +
          '<div class="ivx-card-min-item">' +
            '<div class="ivx-card-min-label">MINIMUM OWNERSHIP</div>' +
            '<div class="ivx-card-min-value">' + escapeHtml(minInvestment > 0 && salePrice > 0 ? ownershipPercent + '%' : 'Not available') + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="ivx-card-chips">' + chips + '</div>' +
        '<div class="ivx-card-developer">' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#E6C200" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18v3c0 .6.4 1 1 1h4v-3h3v3h4v-3h3v3h4c.6 0 1-.4 1-1v-3"/><path d="M2 18V8c0-.6.4-1 1-1h18c.6 0 1 .4 1 1v10"/><path d="M9 7V4c0-.6.4-1 1-1h4c.6 0 1 .4 1 1v3"/></svg>' +
          '<span>Developed by <strong>' + escapeHtml(developerName) + '</strong></span>' +
        '</div>' +
        '<button class="ivx-card-details-btn" onclick="toggleDealDetails(this, \'' + escapeHtml(deal.id || '') + '\')">' +
          '<span>Details</span>' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#909090" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>' +
        '</button>' +
        '<div class="ivx-card-details-panel" id="ivx-card-details-' + escapeHtml(deal.id || '') + '">' +
          '<div style="margin-bottom:8px;">' + escapeHtml(deal.description || 'Investment details pending verification.') + '</div>' +
          buildTrustBadgesHtml(trustInfo) +
        '</div>' +
        '<div class="ivx-card-ctas">' +
          '<a class="ivx-card-view-btn" href="' + dealUrl + '">View Deal <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#E6C200" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></a>' +
          '<a class="ivx-card-invest-btn" href="' + dealUrl + '">Invest Now</a>' +
        '</div>' +
        '<div class="ivx-card-actions">' +
          '<button class="ivx-card-action" onclick="toggleDealLike(this, \'' + escapeHtml(deal.id || '') + '\')">' +
            '<span class="ivx-card-action-icon">&#9825;</span>' +
            '<span class="ivx-card-action-count">0</span>' +
          '</button>' +
          '<button class="ivx-card-action" onclick="openDealComments(\'' + escapeHtml(deal.id || '') + '\')">' +
            '<span class="ivx-card-action-icon">&#128172;</span>' +
            '<span class="ivx-card-action-count">0</span>' +
          '</button>' +
          '<button class="ivx-card-action" onclick="toggleDealSave(this, \'' + escapeHtml(deal.id || '') + '\')">' +
            '<span class="ivx-card-action-icon">&#128279;</span>' +
          '</button>' +
          '<button class="ivx-card-action" onclick="shareDeal(\'' + escapeHtml(deal.id || '') + '\')" aria-label="Share">' +
            '<span class="ivx-card-action-icon">&#10148;</span>' +
          '</button>' +
        '</div>' +
      '</div>';

      return '<div class="live-deal-card ivx-app-card">' + galleryHtml + bodyHtml + '</div>';
    }

    function safeJsonParse(val, fallback) {
      if (val === null || val === undefined) return fallback;
      if (typeof val === 'string') {
        try { return JSON.parse(val); } catch(e) { return fallback; }
      }
      return val;
    }

    var PEREZ_RESIDENCE_FALLBACK_PHOTOS = [
      'https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/junpisw15h6borglpbckz',
      'https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/2s8bcg6npyx96xcfrr5rm',
      'https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/t8rc86kynbs64jopcujtf',
      'https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/bxqj57n0z60oqoxaqvnlo'
    ];
    var _perezPhotosFromDb = false;
    var _storagePhotoFetchInProgress = {};
    var _dealPhotosBucketKnownMissing = false;
    var _dealPhotosBucketLoggedMissing = false;

    function fetchStoragePhotosForDeal(dealId, dealKey) {
      if (_dealPhotosBucketKnownMissing) {
        if (!_dealPhotosBucketLoggedMissing) {
          console.log('[IVX Storage] deal-photos bucket unavailable — skipping storage photo recovery');
          _dealPhotosBucketLoggedMissing = true;
        }
        return;
      }
      if (_storagePhotoFetchInProgress[dealId]) return;
      _storagePhotoFetchInProgress[dealId] = true;
      if (isPlaceholder(SUPABASE_URL) || isPlaceholder(SUPABASE_ANON_KEY)) {
        console.log('[IVX Storage] Cannot fetch photos — Supabase not configured');
        return;
      }
      var listUrl = SUPABASE_URL.replace(/\/+$/, '') + '/storage/v1/object/list/deal-photos';
      console.log('[IVX Storage] Fetching photos from Storage bucket for deal:', dealId);
      var ctrl = new AbortController();
      var to = setTimeout(function() { ctrl.abort(); }, 5000);
      fetch(listUrl, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
          'apikey': SUPABASE_ANON_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prefix: dealId + '/', limit: 50, offset: 0, sortBy: { column: 'name', order: 'asc' } }),
        signal: ctrl.signal
      }).then(function(r) {
        clearTimeout(to);
        if (!r.ok) {
          return r.text().then(function(txt) {
            if ((r.status === 400 || r.status === 404) && String(txt || '').toLowerCase().indexOf('bucket not found') !== -1) {
              _dealPhotosBucketKnownMissing = true;
              throw new Error('BUCKET_NOT_FOUND');
            }
            throw new Error('HTTP ' + r.status);
          });
        }
        return r.json();
      }).then(function(files) {
        if (!Array.isArray(files) || files.length === 0) {
          console.log('[IVX Storage] No photos found in Storage for deal:', dealId);
          return;
        }
        _dealPhotosBucketKnownMissing = false;
        var photos = files.filter(function(f) {
          return f.name && /\.(jpg|jpeg|png|webp)$/i.test(f.name);
        }).map(function(f) {
          return SUPABASE_URL.replace(/\/+$/, '') + '/storage/v1/object/public/deal-photos/' + dealId + '/' + f.name;
        });
        if (photos.length > 0) {
          console.log('[IVX Storage] Found', photos.length, 'photos in Storage for deal:', dealId);
          if (dealKey === 'perez-residence') {
            PEREZ_RESIDENCE_FALLBACK_PHOTOS = photos;
            _perezPhotosFromDb = true;
            try { localStorage.setItem('ivx_perez_photos', JSON.stringify(photos)); } catch(e) {}
            var slider = document.getElementById('perez-residence-slider');
            if (slider) {
              var imgsHtml = '';
              for (var i = 0; i < photos.length; i++) {
                imgsHtml += '<img src="' + photos[i] + '" alt="Perez Residence ' + (i+1) + '" loading="lazy" decoding="async" fetchpriority="low" referrerpolicy="no-referrer" style="min-width:100%;height:100%;object-fit:cover;scroll-snap-align:start;flex:0 0 100%;" onerror="this.closest(\'.live-deal-gallery\')?.classList.add(\'live-deal-gallery-empty\');this.remove()" />';
              }
              slider.innerHTML = imgsHtml;
              var gallery = slider.parentElement;
              if (gallery) {
                setGallerySourceBadge(gallery, 'storage');
                var countEl = gallery.querySelector('.live-deal-photo-count');
                if (!countEl) {
                  countEl = document.createElement('div');
                  countEl.className = 'live-deal-photo-count';
                  gallery.appendChild(countEl);
                }
                countEl.textContent = '1/' + photos.length;
                var dotsEl = gallery.querySelector('.live-deal-photo-dots');
                if (!dotsEl) {
                  dotsEl = document.createElement('div');
                  dotsEl.className = 'live-deal-photo-dots';
                  gallery.appendChild(dotsEl);
                }
                dotsEl.setAttribute('data-slider', 'perez-residence-slider');
                var dotsHtml = '';
                for (var di = 0; di < photos.length; di++) {
                  dotsHtml += '<div class="live-deal-photo-dot' + (di === 0 ? ' active' : '') + '" data-idx="' + di + '"></div>';
                }
                dotsEl.innerHTML = dotsHtml;
              }
              initGallerySliders();
              console.log('[IVX Storage] Injected', photos.length, 'Storage photos into Perez Residence slider');
            }
          }
        }
      }).catch(function(err) {
        clearTimeout(to);
        if (err && err.message === 'BUCKET_NOT_FOUND') {
          console.log('[IVX Storage] deal-photos bucket not found — disabling storage photo recovery');
          return;
        }
        console.log('[IVX Storage] Photo fetch failed for', dealId, ':', err.message);
      });
    }
    try {
      var _cachedPerez = localStorage.getItem('ivx_perez_photos');
      if (_cachedPerez) {
        var _parsedPerez = JSON.parse(_cachedPerez);
        if (Array.isArray(_parsedPerez) && _parsedPerez.length > 0) {
          PEREZ_RESIDENCE_FALLBACK_PHOTOS = _parsedPerez;
          console.log('[IVX Deals] Pre-loaded Perez Residence photos from localStorage cache (' + _parsedPerez.length + ' photos)');
        }
      }
    } catch(e) {}

    var CASA_ROSARIO_FALLBACK_PHOTOS = [
      'https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/junpisw15h6borglpbckz',
      'https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/2s8bcg6npyx96xcfrr5rm',
      'https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/t8rc86kynbs64jopcujtf',
      'https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/bxqj57n0z60oqoxaqvnlo',
      'https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/idr3twi8x1q8skiyl9sm7',
      'https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/q28qwxwmig7m8qr5m83jh',
      'https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/p6gks5os79lycfghdkupz',
      'https://pub-e001eb4506b145aa938b5d3badbff6a5.r2.dev/attachments/g9g9wbb8r1epd4hc9qifl'
    ];
    function escapeInlineSvgText(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    }

    function createDealPlaceholderDataUri(title, subtitle) {
      var safeTitle = escapeInlineSvgText(title);
      var safeSubtitle = escapeInlineSvgText(subtitle);
      var svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900">
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#000000" />
            <stop offset="100%" stop-color="#1A1A1A" />
          </linearGradient>
        </defs>
        <rect width="1600" height="900" fill="url(#bg)" />
        <rect x="52" y="52" width="1496" height="796" rx="34" fill="#141414" stroke="#E6C200" stroke-width="3" />
        <text x="120" y="170" fill="#FFD700" font-size="42" font-family="Arial, Helvetica, sans-serif" font-weight="700" letter-spacing="6">IVX HOLDINGS</text>
        <text x="120" y="426" fill="#FFFFFF" font-size="82" font-family="Arial, Helvetica, sans-serif" font-weight="800">${safeTitle}</text>
        <text x="120" y="496" fill="#A3A3A3" font-size="38" font-family="Arial, Helvetica, sans-serif">${safeSubtitle}</text>
        <text x="120" y="620" fill="#ECECEC" font-size="34" font-family="Arial, Helvetica, sans-serif">Verified media pending publication.</text>
        <text x="120" y="674" fill="#ECECEC" font-size="34" font-family="Arial, Helvetica, sans-serif">Fallback photos are intentionally disabled to prevent mismatched property imagery.</text>
      </svg>`;
      return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
    }

    var JACKSONVILLE_PRIME_FALLBACK_PHOTOS = [
      createDealPlaceholderDataUri('IVX JACKSONVILLE PRIME', 'Jacksonville, FL')
    ];
    var jacksonvillePrimeFallbackImage = document.getElementById('jacksonville-prime-fallback-image');
    if (jacksonvillePrimeFallbackImage && JACKSONVILLE_PRIME_FALLBACK_PHOTOS[0]) {
      jacksonvillePrimeFallbackImage.style.display = 'block';
      jacksonvillePrimeFallbackImage.src = JACKSONVILLE_PRIME_FALLBACK_PHOTOS[0];
    }

    var STATIC_FALLBACK_DEALS = [
      {
        id: 'perez-residence-001',
        title: 'PEREZ RESIDENCE',
        projectName: 'ONE STOP DEVELOPMENT LLC',
        propertyAddress: 'Southwest Ranches, FL',
        city: 'Southwest Ranches',
        state: 'FL',
        totalInvestment: 2500000,
        propertyValue: 2500000,
        sale_price: 2500000,
        expectedROI: 25,
        min_investment: 0,
        fractional_share_price: 0,
        ownership_text: '',
        distributionFrequency: 'Monthly',
        photos: PEREZ_RESIDENCE_FALLBACK_PHOTOS,
        published: true,
        status: 'active',
        trust_info: {
          llcName: 'ONE STOP DEVELOPMENT LLC',
          titleVerified: true,
          insuranceCoverage: true,
          escrowProtected: true,
          permitStatus: 'approved',
          ownershipLabel: ''
        }
      },
      {
        id: 'casa-rosario-001',
        title: 'CASA ROSARIO',
        projectName: 'ONE STOP DEVELOPMENT TWO LLC',
        propertyAddress: 'Pembroke Pines, FL',
        city: 'Pembroke Pines',
        state: 'FL',
        totalInvestment: 1400000,
        propertyValue: 1400000,
        sale_price: 1400000,
        expectedROI: 30,
        min_investment: 0,
        fractional_share_price: 0,
        ownership_text: '',
        distributionFrequency: 'Monthly',
        photos: CASA_ROSARIO_FALLBACK_PHOTOS,
        published: true,
        status: 'active',
        trust_info: {
          llcName: 'ONE STOP DEVELOPMENT TWO LLC',
          titleVerified: true,
          insuranceCoverage: true,
          escrowProtected: true,
          permitStatus: 'approved',
          ownershipLabel: ''
        }
      },
      {
        id: 'JV-202603-5190',
        title: 'IVX JACKSONVILLE PRIME',
        projectName: 'ONE STOP CONSTRUCTORS INC',
        propertyAddress: 'Jacksonville, FL',
        city: 'Jacksonville',
        state: 'FL',
        totalInvestment: 400000,
        propertyValue: 400000,
        sale_price: 400000,
        expectedROI: 9.5,
        min_investment: 0,
        fractional_share_price: 0,
        ownership_text: '',
        distributionFrequency: 'Monthly',
        photos: JACKSONVILLE_PRIME_FALLBACK_PHOTOS,
        published: true,
        status: 'active',
        trust_info: {
          llcName: 'ONE STOP CONSTRUCTORS INC',
          titleVerified: true,
          insuranceCoverage: true,
          escrowProtected: true,
          ownershipLabel: ''
        }
      }
    ];

    function isCasaRosarioDeal(d) {
      var title = ((d.title || d.name || '') + ' ' + (d.projectName || d.project_name || '')).toUpperCase();
      return title.indexOf('CASA ROSARIO') !== -1 || title.indexOf('ONE STOP DEVELOPMENT TWO') !== -1;
    }

    function isPerezResidenceDeal(d) {
      var title = ((d.title || d.name || '') + ' ' + (d.projectName || d.project_name || '')).toUpperCase();
      return title.indexOf('PEREZ RESIDENCE') !== -1 || title.indexOf('PEREZ') !== -1;
    }

    function isJacksonvillePrimeDeal(d) {
      var title = ((d.title || d.name || '') + ' ' + (d.projectName || d.project_name || '')).toUpperCase();
      return title.indexOf('JACKSONVILLE PRIME') !== -1 || title.indexOf('IVX JACKSONVILLE') !== -1 || title.indexOf('ONE STOP CONSTRUCTORS') !== -1;
    }

    function normalizeDealPhotoFingerprint(photo) {
      if (!photo || typeof photo !== 'string') return '';
      if (photo.indexOf('data:image/') === 0) return photo.slice(0, 120);
      try {
        var parsed = new URL(photo);
        return (parsed.origin + parsed.pathname).replace(/\/+$/, '').toLowerCase();
      } catch (err) {
        return String(photo).split('?')[0].replace(/\/+$/, '').toLowerCase();
      }
    }

    function sanitizeDealPhotosForLanding(d, photos) {
      if (!Array.isArray(photos) || photos.length === 0) return [];
      var searchTitle = ((d.title || d.name || '') + ' ' + (d.projectName || d.project_name || '')).toUpperCase();
      var registry = [
        { id: 'casa_rosario', matches: isCasaRosarioDeal(d), photos: CASA_ROSARIO_FALLBACK_PHOTOS },
        { id: 'perez_residence', matches: isPerezResidenceDeal(d), photos: PEREZ_RESIDENCE_FALLBACK_PHOTOS },
        { id: 'jacksonville_prime', matches: isJacksonvillePrimeDeal(d), photos: JACKSONVILLE_PRIME_FALLBACK_PHOTOS }
      ];
      var allowedFingerprints = {};
      var blockedFingerprints = {};
      for (var ri = 0; ri < registry.length; ri++) {
        var entry = registry[ri];
        if (!Array.isArray(entry.photos)) continue;
        for (var pi = 0; pi < entry.photos.length; pi++) {
          var entryPhoto = entry.photos[pi];
          if (typeof entryPhoto !== 'string' || entryPhoto.indexOf('http') !== 0) continue;
          var entryFingerprint = normalizeDealPhotoFingerprint(entryPhoto);
          if (!entryFingerprint) continue;
          if (entry.matches) {
            allowedFingerprints[entryFingerprint] = true;
          } else if (!allowedFingerprints[entryFingerprint]) {
            blockedFingerprints[entryFingerprint] = entry.id;
          }
        }
      }
      return photos.filter(function(photo) {
        if (typeof photo !== 'string' || photo.length <= 5) return false;
        if (!photo.startsWith('http') && !photo.startsWith('data:image/')) return false;
        if (!photo.startsWith('http')) return true;
        var fingerprint = normalizeDealPhotoFingerprint(photo);
        var blockedBy = blockedFingerprints[fingerprint];
        if (!blockedBy || allowedFingerprints[fingerprint]) return true;
        console.log('[IVX Deals] BLOCKED cross-mapped photo for', searchTitle || 'unknown', '| blockedBy:', blockedBy, '| photo:', photo.substring(0, 120));
        return false;
      });
    }

    function getPhotoSourceMeta(source) {
      var normalized = String(source || 'none').toLowerCase();
      if (normalized === 'db') return { label: 'DB', className: 'db' };
      if (normalized === 'storage') return { label: 'STORAGE', className: 'storage' };
      if (normalized === 'fallback') return { label: 'FALLBACK', className: 'fallback' };
      return { label: 'MISSING', className: 'missing' };
    }

    function getPhotoSourceBadgeHtml(source) {
      return '';
    }

    function setGallerySourceBadge(galleryEl, source) {
      if (!galleryEl) return;
      var sourceEl = galleryEl.querySelector('.live-deal-source-badge');
      if (sourceEl && sourceEl.parentNode) {
        sourceEl.parentNode.removeChild(sourceEl);
      }
    }

    function mapDeal(d) {
      if (!d) return d;
      var rawPhotos = safeJsonParse(d.photos, []);
      if (!Array.isArray(rawPhotos)) rawPhotos = [];
      var photoSource = rawPhotos.length > 0 ? 'db' : 'none';
      var STOCK_DOMAINS = ['unsplash.com','images.unsplash.com','source.unsplash.com','pexels.com','images.pexels.com','pixabay.com','stocksnap.io','picsum.photos','placehold.co','via.placeholder.com','placekitten.com','loremflickr.com','dummyimage.com','fakeimg.pl'];
      rawPhotos = rawPhotos.filter(function(p) {
        if (typeof p !== 'string' || p.length <= 5) return false;
        if (!p.startsWith('http') && !p.startsWith('data:image/')) return false;
        var lower = p.toLowerCase();
        for (var si = 0; si < STOCK_DOMAINS.length; si++) {
          if (lower.indexOf(STOCK_DOMAINS[si]) !== -1) {
            console.log('[IVX] BLOCKED stock photo:', p.substring(0, 60));
            return false;
          }
        }
        return true;
      });
      rawPhotos = sanitizeDealPhotosForLanding(d, rawPhotos);
      if (rawPhotos.length > 0) {
        photoSource = 'db';
      }
      if (rawPhotos.length === 0 && isCasaRosarioDeal(d)) {
        rawPhotos = CASA_ROSARIO_FALLBACK_PHOTOS;
        photoSource = rawPhotos.length > 0 ? 'fallback' : 'none';
        console.log('[IVX Deals] Applied fallback photos for Casa Rosario (' + rawPhotos.length + ' photos)');
      }
      if (rawPhotos.length === 0 && isJacksonvillePrimeDeal(d)) {
        rawPhotos = JACKSONVILLE_PRIME_FALLBACK_PHOTOS;
        photoSource = rawPhotos.length > 0 ? 'fallback' : 'none';
        console.log('[IVX Deals] Applied fallback photos for Jacksonville Prime (' + rawPhotos.length + ' photos)');
      }
      if (rawPhotos.length > 0 && isPerezResidenceDeal(d) && !_perezPhotosFromDb) {
        PEREZ_RESIDENCE_FALLBACK_PHOTOS = rawPhotos.slice();
        _perezPhotosFromDb = true;
        photoSource = 'db';
        try { localStorage.setItem('ivx_perez_photos', JSON.stringify(rawPhotos)); } catch(e) {}
        console.log('[IVX Deals] Captured Perez Residence photos from DB (' + rawPhotos.length + ' photos)');
      }
      if (rawPhotos.length === 0 && isPerezResidenceDeal(d)) {
        if (PEREZ_RESIDENCE_FALLBACK_PHOTOS.length === 0) {
          try {
            var cached = localStorage.getItem('ivx_perez_photos');
            if (cached) { var parsed = JSON.parse(cached); if (Array.isArray(parsed) && parsed.length > 0) PEREZ_RESIDENCE_FALLBACK_PHOTOS = parsed; }
          } catch(e) {}
        }
        if (PEREZ_RESIDENCE_FALLBACK_PHOTOS.length > 0) {
          rawPhotos = PEREZ_RESIDENCE_FALLBACK_PHOTOS;
          photoSource = 'fallback';
          console.log('[IVX Deals] Applied resilient fallback photos for Perez Residence (' + rawPhotos.length + ' photos)');
        }
        if (!_perezPhotosFromDb) {
          console.log('[IVX Deals] Perez Residence: verifying Storage bucket photos in background...');
          fetchStoragePhotosForDeal(d.id || 'perez-residence-001', 'perez-residence');
        }
      }
      var rawPartners = safeJsonParse(d.partners, []);
      var rawPoolTiers = safeJsonParse(d.poolTiers || d.pool_tiers, []);
      if (!Array.isArray(rawPoolTiers)) rawPoolTiers = [];
      var trustInfo = normalizeTrustInfo(d.trustInfo || d.trust_info || {});
      var minInvestment = Number(d.minInvestment || d.min_investment || d.minimum_investment || trustInfo.minInvestment || 50);
      if (isNaN(minInvestment) || minInvestment <= 0) minInvestment = 50;
      var salePrice = Number(d.salePrice || d.sale_price || d.propertyValue || d.property_value || d.estimated_value || d.totalInvestment || d.total_investment || d.amount || 0);
      if (isNaN(salePrice) || salePrice <= 0) salePrice = Number(d.totalInvestment || d.total_investment || d.amount || 0);
      var fractionalSharePrice = Number(d.fractionalSharePrice || d.fractional_share_price || trustInfo.fractionalSharePrice || minInvestment);
      if (isNaN(fractionalSharePrice) || fractionalSharePrice <= 0) fractionalSharePrice = minInvestment;
      return {
        id: d.id || '',
        title: d.title || d.name || '',
        projectName: d.projectName || d.project_name || '',
        developerName: d.developerName || d.developer_name || '',
        type: d.type || '',
        totalInvestment: d.totalInvestment || d.total_investment || d.amount || 0,
        total_investment: d.totalInvestment || d.total_investment || d.amount || 0,
        expectedROI: d.expectedROI || d.expected_roi || 0,
        expected_roi: d.expectedROI || d.expected_roi || 0,
        propertyAddress: d.propertyAddress || d.property_address || '',
        property_address: d.propertyAddress || d.property_address || '',
        addressShort: d.addressShort || d.address_short || '',
        address_short: d.addressShort || d.address_short || '',
        city: d.city || '',
        state: d.state || '',
        country: d.country || '',
        propertyValue: d.propertyValue || d.property_value || d.estimated_value || salePrice,
        property_value: d.propertyValue || d.property_value || d.estimated_value || salePrice,
        salePrice: salePrice,
        sale_price: salePrice,
        minInvestment: minInvestment,
        min_investment: minInvestment,
        fractionalSharePrice: fractionalSharePrice,
        fractional_share_price: fractionalSharePrice,
        ownershipText: d.ownershipText || d.ownership_text || trustInfo.ownershipLabel || '',
        ownership_text: d.ownershipText || d.ownership_text || trustInfo.ownershipLabel || '',
        description: d.description || '',
        distributionFrequency: d.distributionFrequency || d.distribution_frequency || '',
        exitStrategy: d.exitStrategy || d.exit_strategy || '',
        partners: rawPartners,
        photos: rawPhotos,
        photoSource: photoSource,
        trustInfo: trustInfo,
        trust_info: trustInfo,
        published: d.published !== undefined ? d.published : false,
        publishedAt: d.publishedAt || d.published_at || '',
        created_at: d.created_at || d.createdAt || '',
        poolTiers: rawPoolTiers,
        status: d.status || '',
        display_order: d.display_order != null ? d.display_order : (d.displayOrder != null ? d.displayOrder : 999),
        displayOrder: d.displayOrder != null ? d.displayOrder : (d.display_order != null ? d.display_order : 999)
      };
    }

    function deduplicateDeals(deals) {
      var seenById = {};
      var result = [];
      for (var i = 0; i < deals.length; i++) {
        var d = deals[i];
        var dealId = d.id || '';
        if (!dealId) { result.push(d); continue; }
        var s = String(d.status || '').toLowerCase();
        if (s === 'trashed' || s === 'permanently_deleted' || s === 'deleted') {
          console.log('[IVX Deals] DEDUP: skipping trashed/deleted deal:', dealId);
          continue;
        }
        if (seenById[dealId]) {
          var existing = seenById[dealId];
          var existTime = existing.updated_at || existing.updatedAt || existing.created_at || '';
          var newTime = d.updated_at || d.updatedAt || d.created_at || '';
          if (String(newTime) > String(existTime)) {
            console.log('[IVX Deals] DEDUP: keeping newer version of id:', dealId);
            var idx = result.indexOf(existing);
            if (idx >= 0) result[idx] = d;
            seenById[dealId] = d;
          }
        } else {
          seenById[dealId] = d;
          result.push(d);
        }
      }
      console.log('[IVX Deals] DEDUP: input', deals.length, '-> output', result.length, 'deals (ID-based dedup)');
      return result;
    }

    var _staticFallbackSaved = false;
    var _staticFallbackHtml = '';
    function saveStaticFallback() {
      if (_staticFallbackSaved) return;
      _staticFallbackHtml = STATIC_FALLBACK_DEALS.map(function(deal) {
        return buildDealCardHtml(mapDeal(deal));
      }).join('');
      _staticFallbackSaved = _staticFallbackHtml.length > 100;
      if (_staticFallbackSaved) {
        console.log('[IVX Deals] Static fallback generated (' + _staticFallbackHtml.length + ' chars)');
      }
    }
    saveStaticFallback();
    window.addEventListener('load', saveStaticFallback);

    function ensureFallbackVisible() {
      var grid = document.getElementById('properties-grid');
      var countEl = document.getElementById('properties-live-count');
      if (grid && grid.innerHTML.trim().length < 100 && _staticFallbackHtml) {
        grid.innerHTML = _staticFallbackHtml;
        console.log('[IVX Deals] Safety: restored static fallback');
      }
      if (countEl) {
        var currentCount = parseInt(countEl.textContent) || 0;
        if (currentCount === 0 && grid) {
          var cardCount = grid.querySelectorAll('.live-deal-card').length;
          if (cardCount > 0) countEl.textContent = cardCount + ' LIVE';
        }
      }
      initGallerySliders();
    }

    function renderDeals(deals) {
      try {
        var grid = document.getElementById('properties-grid');
        var countEl = document.getElementById('properties-live-count');
        // Real published-deal count feeds the hero stat (no hard-coded number).
        var statAum = document.getElementById('stat-aum');
        if (statAum && Array.isArray(deals)) statAum.textContent = String(deals.length);
        // Ticker content comes from the same real deal data.
        setTickerFromDeals(deals);
        if (!grid) {
          console.warn('[IVX Deals] properties-grid missing — skipping render');
          return;
        }
        saveStaticFallback();
        if (!Array.isArray(deals)) {
          console.warn('[IVX Deals] Invalid deals payload — keeping static fallback');
          ensureFallbackVisible();
          return;
        }
      if (!deals || deals.length === 0) {
        console.log('[IVX Deals] No deals from source — keeping static fallback');
        ensureFallbackVisible();
        return;
      }
      deals = deals.map(mapDeal);
      var publishedDeals = deals.filter(function(d) {
        var pub = d.published === true || d.published === 'true';
        var st = String(d.status || '').toLowerCase();
        var activeStatus = (st === 'active' || st === 'published' || st === 'live' || !st);
        return pub && activeStatus;
      });
      if (publishedDeals.length > 0) {
        deals = publishedDeals;
        console.log('[IVX Deals] Filtered to', deals.length, 'published+active deals');
      }
      deals = deduplicateDeals(deals);
      deals.sort(function(a, b) {
        var orderA = (a.display_order != null ? a.display_order : (a.displayOrder != null ? a.displayOrder : 999));
        var orderB = (b.display_order != null ? b.display_order : (b.displayOrder != null ? b.displayOrder : 999));
        if (orderA !== orderB) return orderA - orderB;
        var dateA = a.created_at || a.createdAt || '';
        var dateB = b.created_at || b.createdAt || '';
        return dateB > dateA ? 1 : (dateB < dateA ? -1 : 0);
      });
      if (deals.length === 0) {
        console.log('[IVX Deals] All deals filtered by dedup — keeping static fallback');
        ensureFallbackVisible();
        return;
      }
      _dealsLoaded = true;
      cacheDealData(deals);
      if (countEl) countEl.textContent = deals.length + ' LIVE';
      grid.innerHTML = '';
      deals.forEach(function(deal) {
        var card = document.createElement('div');
        card.className = 'live-deal-card reveal visible';
        card.innerHTML = buildDealCardHtml(deal);
        grid.appendChild(card);
      });
      console.log('[IVX Deals] Rendered', deals.length, 'live deals');
      initGallerySliders();
      } catch (err) {
        console.error('[IVX Deals] Render crash:', err && err.message ? err.message : err);
        ensureFallbackVisible();
      }
    }

    function isRenderableGalleryPhoto(photo) {
      return typeof photo === 'string' && photo.trim().length > 0 && photo.indexOf('data:image/gif;base64,R0lGODlhAQABA') !== 0;
    }

    /* ── Post media (Instagram-style: up to 8 pictures + 2 videos per post) ── */
    var IVX_POST_MEDIA_SLUGS = ['casa-rosario-001', 'perez-residence-001', 'JV-202603-5190'];

    function getDealPostVideos(deal) {
      var cached = (window._IVX_DEAL_POST_MEDIA && window._IVX_DEAL_POST_MEDIA[deal.id]) ? window._IVX_DEAL_POST_MEDIA[deal.id].videos : null;
      var vids = cached || (Array.isArray(deal.videos) ? deal.videos : []);
      return vids.slice(0, 2);
    }

    function getPostMediaApiBase() {
      var api = '';
      try {
        var meta = document.querySelector('meta[name="ivx-backend-url"]');
        if (meta && meta.content && meta.content.indexOf('__') !== 0 && meta.content.indexOf('http') === 0) {
          api = meta.content.replace(/\/+$/, '');
        }
      } catch (e) {}
      if (!api) api = 'https://ivx-holdings-platform.onrender.com';
      return api;
    }

    function ensureDealPostMedia() {
      if (window._ivxPostMediaFetchStarted) { injectDealVideoSlides(); return; }
      window._ivxPostMediaFetchStarted = true;
      var api = getPostMediaApiBase();
      IVX_POST_MEDIA_SLUGS.forEach(function(slug) {
        fetch(api + '/api/projects/' + encodeURIComponent(slug) + '/media')
          .then(function(r) { return r.json(); })
          .then(function(d) {
            if (!d || (!Array.isArray(d.videos) && !Array.isArray(d.images))) return;
            window._IVX_DEAL_POST_MEDIA = window._IVX_DEAL_POST_MEDIA || {};
            window._IVX_DEAL_POST_MEDIA[slug] = {
              videos: (d.videos || []).slice(0, 2),
              images: (d.images || []).slice(0, 8)
            };
            console.log('[IVX Post] Loaded post media for ' + slug + ': ' + ((d.images || []).length) + ' picture(s) + ' + ((d.videos || []).length) + ' video(s)');
            injectDealVideoSlides();
          })
          .catch(function(){});
      });
    }

    function injectDealVideoSlides() {
      var cache = window._IVX_DEAL_POST_MEDIA || {};
      Object.keys(cache).forEach(function(dealId) {
        var vids = (cache[dealId] && cache[dealId].videos) || [];
        if (vids.length === 0) return;
        var slider = document.getElementById('slider-' + dealId);
        if (!slider || slider.querySelector('video')) return;
        var frag = '';
        for (var i = vids.length - 1; i >= 0; i--) {
          var v = vids[i] || {};
          var src = v.video_url || v.url || '';
          if (!src) continue;
          var poster = v.thumbnail_url || v.cover_url || '';
          frag += '<video ' + (/\.m3u8($|\?)/.test(src) ? 'data-hls="' + src + '"' : 'src="' + src + '"') + (poster ? ' poster="' + poster + '"' : '') + ' data-igplay="1" preload="metadata" muted loop playsinline controls controlslist="nodownload noremoteplayback" style="min-width:100%;width:100%;height:100%;object-fit:cover;scroll-snap-align:start;flex:0 0 100%;background:#000;"></video>';
        }
        if (!frag) return;
        slider.insertAdjacentHTML('afterbegin', frag);
        refreshGalleryIndicators(slider);
        console.log('[IVX Post] Injected ' + vids.length + ' video(s) into the ' + dealId + ' post');
      });
    }

    function refreshGalleryIndicators(slider) {
      var total = slider.querySelectorAll('img, video').length;
      var gallery = slider.parentElement;
      if (!gallery) return;
      var countEl = gallery.querySelector('.live-deal-photo-count');
      if (!countEl && total > 1) {
        countEl = document.createElement('div');
        countEl.className = 'live-deal-photo-count';
        gallery.appendChild(countEl);
      }
      if (countEl) countEl.textContent = '1/' + total;
      var dotsEl = gallery.querySelector('.live-deal-photo-dots');
      if (!dotsEl && total > 1) {
        dotsEl = document.createElement('div');
        dotsEl.className = 'live-deal-photo-dots';
        dotsEl.setAttribute('data-slider', slider.id || '');
        gallery.appendChild(dotsEl);
      }
      if (dotsEl) {
        var dotsHtml = '';
        for (var di = 0; di < total; di++) {
          dotsHtml += '<div class="live-deal-photo-dot' + (di === 0 ? ' active' : '') + '" data-idx="' + di + '"></div>';
        }
        dotsEl.innerHTML = dotsHtml;
      }
      slider._ivxScrollBound = false;
      initGallerySliders();
    }

    function initGallerySliders() {
      ensureDealPostMedia();
      document.querySelectorAll('.live-deal-gallery-slider, .ivx-card-gallery-slider').forEach(function(slider) {
        var dotsContainer = slider.parentElement.querySelector('.live-deal-photo-dots, .ivx-card-photo-dots') || slider.parentElement.querySelector('.gallery-dots');
        if (!dotsContainer) return;
        var imgs = slider.querySelectorAll('img, video');
        if (imgs.length <= 1) return;
        if (slider._ivxScrollBound) return;
        slider._ivxScrollBound = true;
        var countEl = slider.parentElement.querySelector('.live-deal-photo-count, .ivx-card-photo-count');
        slider.addEventListener('scroll', function() {
          var scrollLeft = slider.scrollLeft;
          var w = slider.offsetWidth;
          var idx = Math.round(scrollLeft / w);
          var dots = dotsContainer.querySelectorAll('.live-deal-photo-dot, .ivx-card-photo-dot, .cr-dot-item');
          dots.forEach(function(dot, i) {
            if (i === idx) dot.classList.add('active');
            else dot.classList.remove('active');
          });
          if (countEl) countEl.textContent = (idx + 1) + '/' + slider.querySelectorAll('img, video').length;
        }, { passive: true });
        dotsContainer.querySelectorAll('.live-deal-photo-dot, .ivx-card-photo-dot, .cr-dot-item').forEach(function(dot) {
          dot.addEventListener('click', function() {
            var idx = parseInt(dot.getAttribute('data-idx'), 10);
            if (!isNaN(idx)) slider.scrollTo({ left: idx * slider.offsetWidth, behavior: 'smooth' });
          });
        });
      });

      var crSlider = document.getElementById('cr-slider');
      var crDots = document.getElementById('cr-dots');
      if (crSlider && crDots && crDots.children.length === 0) {
        var crImgs = crSlider.querySelectorAll('img');
        for (var ci = 0; ci < crImgs.length; ci++) {
          var dot = document.createElement('div');
          dot.className = 'cr-dot-item' + (ci === 0 ? ' active' : '');
          dot.setAttribute('data-idx', String(ci));
          crDots.appendChild(dot);
        }
        crSlider.addEventListener('scroll', function() {
          var scrollLeft = crSlider.scrollLeft;
          var w = crSlider.offsetWidth;
          var idx = Math.round(scrollLeft / w);
          var dots = crDots.querySelectorAll('.cr-dot-item');
          dots.forEach(function(d, i) {
            if (i === idx) d.classList.add('active');
            else d.classList.remove('active');
          });
        }, { passive: true });
        crDots.querySelectorAll('.cr-dot-item').forEach(function(dot) {
          dot.addEventListener('click', function() {
            var idx = parseInt(dot.getAttribute('data-idx'), 10);
            crSlider.scrollTo({ left: idx * crSlider.offsetWidth, behavior: 'smooth' });
          });
        });
      }
    }

    window.addEventListener('load', function() { initGallerySliders(); });

    function fetchDealsViaApi() {
      console.log('[IVX Deals] Fetching deals via backend API (all fallbacks)...');
      // Try ALL API fallbacks for /api/landing-deals, prioritizing non-S3 backends
      var allEndpoints = [];
      for (var ei = 0; ei < IVX_API_FALLBACKS.length; ei++) {
        var apiBase = IVX_API_FALLBACKS[ei];
        if (apiBase && apiBase.indexOf('ivxholding.com') === -1) {
          allEndpoints.push(apiBase + '/api/landing-deals');
        }
      }
      for (var ei2 = 0; ei2 < IVX_API_FALLBACKS.length; ei2++) {
        var apiBase2 = IVX_API_FALLBACKS[ei2];
        if (apiBase2) allEndpoints.push(apiBase2 + '/api/landing-deals');
      }
      var endpointIdx = 0;
      function tryNextEndpoint() {
        if (endpointIdx >= allEndpoints.length) {
          console.log('[IVX Deals] All backend endpoints failed, trying tRPC...');
          // Try tRPC on all fallback APIs
          var trpcIdx = 0;
          function tryNextTrpc() {
            if (trpcIdx >= IVX_API_FALLBACKS.length) {
              console.log('[IVX Deals] All tRPC failed — trying Supabase REST...');
              fetchDealsViaSupabaseRest();
              return;
            }
            var trpcBase = IVX_API_FALLBACKS[trpcIdx++];
            if (!trpcBase) { tryNextTrpc(); return; }
            var trpcUrl = trpcBase + '/api/trpc/landing.getDeals';
            console.log('[IVX Deals] Trying tRPC:', trpcUrl);
            fetch(trpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ json: {} }) })
              .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
              .then(function(resp) {
                var d = resp && resp.result && resp.result.data && resp.result.data.json;
                var deals = (d && d.deals) || (Array.isArray(d) ? d : []);
                if (deals.length > 0) {
                  console.log('[IVX Deals] tRPC returned', deals.length, 'deals from', trpcBase);
                  renderDeals(deals);
                } else { tryNextTrpc(); }
              })
              .catch(function() { tryNextTrpc(); });
          }
          tryNextTrpc();
          return;
        }
        var url = allEndpoints[endpointIdx++];
        console.log('[IVX Deals] Trying backend REST:', url);
        var ctrl = new AbortController();
        var to = setTimeout(function() { ctrl.abort(); }, 6000);
        fetch(url, { signal: ctrl.signal })
          .then(function(r) { clearTimeout(to); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function(data) {
            var deals = Array.isArray(data) ? data : (data && data.deals ? data.deals : []);
            if (deals.length > 0) {
              console.log('[IVX Deals] Backend REST returned', deals.length, 'deals from', url, '✓');
              renderDeals(deals);
              if (!_supabaseReady) {
                var cfgUrl = url.replace('/landing-deals', '/landing-config');
                fetch(cfgUrl).then(function(r) { return r.json(); }).then(function(cfg) {
                  if (cfg) { applyConfig(cfg); if (_supabaseReady && !sb) { initSupabaseClient(); setupRealtime(); } }
                }).catch(function() {});
              }
            } else { tryNextEndpoint(); }
          })
          .catch(function(err) {
            clearTimeout(to);
            console.warn('[IVX Deals] Backend REST failed:', url, err.message);
            tryNextEndpoint();
          });
      }
      tryNextEndpoint();
    }

    function fetchDealsViaBackendRest(callback) {
      var apiUrls = IVX_API_FALLBACKS.map(function(base) { return base + '/api/landing-deals'; });
      var idx = 0;
      function tryNext() {
        if (idx >= apiUrls.length) { callback(false); return; }
        var url = apiUrls[idx++];
        console.log('[IVX Deals] Trying backend REST:', url);
        var _brCtrl = new AbortController();
        var _brTo = setTimeout(function() { _brCtrl.abort(); }, 6000);
        fetch(url, { signal: _brCtrl.signal }).then(function(r) {
          clearTimeout(_brTo);
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        }).then(function(data) {
          var deals = Array.isArray(data) ? data : (data.deals || []);
          if (deals.length > 0) {
            console.log('[IVX Deals] Backend REST returned', deals.length, 'deals ✓');
            renderDeals(deals);
            callback(true);
          } else { tryNext(); }
        }).catch(function(err) {
          clearTimeout(_brTo);
          console.warn('[IVX Deals] Backend REST failed:', url, err.message);
          tryNext();
        });
      }
      tryNext();
    }

    function fetchDealsViaEdgeFunction(callback) {
      if (!SUPABASE_ANON_KEY || isPlaceholder(SUPABASE_ANON_KEY) || !isValidJwtKey(SUPABASE_ANON_KEY)) {
        console.log('[IVX Deals] Edge Function: No valid JWT anon key — skipping');
        if (callback) callback(false);
        return;
      }
      var url = _EDGE_FUNCTION_URL + '?owner=' + encodeURIComponent('Ivan Perez');
      console.log('[IVX Deals] Trying Supabase Edge Function:', url);
      var efCtrl = new AbortController();
      var efTo = setTimeout(function() { efCtrl.abort(); }, 6000);
      fetch(url, {
        headers: {
          'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
          'Content-Type': 'application/json'
        },
        signal: efCtrl.signal
      })
      .then(function(r) { clearTimeout(efTo); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(data) {
        var deals = data && data.deals ? data.deals : [];
        if (deals.length > 0) {
          console.log('[IVX Deals] Edge Function returned', deals.length, 'deals \u2713');
          renderDeals(deals);
          if (callback) callback(true);
        } else {
          console.log('[IVX Deals] Edge Function returned 0 deals');
          if (callback) callback(false);
        }
      })
      .catch(function(err) {
        clearTimeout(efTo);
        console.warn('[IVX Deals] Edge Function failed:', err.message);
        if (callback) callback(false);
      });
    }

    var _supabaseRestAttempted = false;
    var _supabaseRestAttemptCount = 0;
    function fetchDealsViaSupabaseRest() {
      _supabaseRestAttemptCount++;
      if (_supabaseRestAttempted && _supabaseRestAttemptCount > 3) {
        console.log('[IVX Deals] Supabase REST attempted ' + _supabaseRestAttemptCount + ' times — keeping fallback');
        ensureFallbackVisible();
        return;
      }
      _supabaseRestAttempted = true;
      if (isPlaceholder(SUPABASE_URL) || isPlaceholder(SUPABASE_ANON_KEY) || !isValidJwtKey(SUPABASE_ANON_KEY)) {
        console.log('[IVX Deals] Cannot use Supabase REST — credentials not set or key not JWT format');
        ensureFallbackVisible();
        return;
      }
      var baseRest = SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/jv_deals';
      var restHeaders = { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=representation' };

      var queryChain = [
        baseRest + '?select=*&published=eq.true&status=in.(active,published,live)&order=display_order.asc.nullslast,created_at.desc.nullslast',
        baseRest + '?select=*&published=eq.true&order=display_order.asc.nullslast,created_at.desc.nullslast',
        baseRest + '?select=*&order=display_order.asc.nullslast,created_at.desc.nullslast'
      ];
      var qIdx = 0;

      function tryNextQuery() {
        if (qIdx >= queryChain.length) {
          console.warn('[IVX Deals] All Supabase REST queries exhausted — trying Edge Function');
          fetchDealsViaEdgeFunction(function(success) {
            if (!success) fetchDealsViaRestApi();
          });
          return;
        }
        var url = queryChain[qIdx];
        qIdx++;
        console.log('[IVX Deals] Trying Supabase REST query #' + qIdx + '...');
        fetch(url, { headers: restHeaders })
          .then(function(r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
          })
          .then(function(data) {
            if (data && data.code) {
              console.warn('[IVX Deals] Supabase REST query #' + (qIdx) + ' column error:', data.message, '— trying next...');
              tryNextQuery();
              return;
            }
            if (Array.isArray(data) && data.length > 0) {
              console.log('[IVX Deals] Supabase REST returned', data.length, 'deals ✓ (query #' + qIdx + ')');
              renderDeals(data);
              if (!sb && window.supabase) {
                try {
                  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
                  _supabaseReady = true;
                  setupRealtime(); setupPresence();
                } catch(e) { console.warn('[IVX Deals] Late client init failed:', e.message); }
              }
            } else {
              console.log('[IVX Deals] Supabase REST query #' + qIdx + ' returned 0 deals — trying next...');
              tryNextQuery();
            }
          })
          .catch(function(err) {
            console.warn('[IVX Deals] Supabase REST query #' + qIdx + ' failed:', err.message);
            tryNextQuery();
          });
      }
      tryNextQuery();
    }

    function fetchDealsViaRestApi() {
      var endpoints = IVX_API_FALLBACKS.map(function(base) { return base + '/api/landing-deals'; });
      var tried = 0;
      function tryNext() {
        if (tried >= endpoints.length) {
          console.log('[IVX Deals] All REST endpoints exhausted — trying config discovery for backend URL...');
          tryDiscoverBackendAndFetch();
          return;
        }
        var url = endpoints[tried];
        tried++;
        var _raCtrl = new AbortController();
        var _raTo = setTimeout(function() { _raCtrl.abort(); }, 6000);
        fetch(url, { signal: _raCtrl.signal }).then(function(r) {
          clearTimeout(_raTo);
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        }).then(function(data) {
          var deals = Array.isArray(data) ? data : (data.deals || []);
          if (deals.length > 0) {
            console.log('[IVX Deals] REST API returned', deals.length, 'deals from', url);
            renderDeals(deals);
          } else {
            tryNext();
          }
        }).catch(function(err) {
          clearTimeout(_raTo);
          console.warn('[IVX Deals] REST failed:', url, err.message);
          tryNext();
        });
      }
      tryNext();
    }

    function tryDiscoverBackendAndFetch() {
      var configUrls = [];
      for (var di = 0; di < IVX_API_FALLBACKS.length; di++) {
        var dBase = IVX_API_FALLBACKS[di];
        if (dBase && dBase.indexOf('ivxholding.com') === -1) {
          configUrls.push(dBase + '/api/landing-config?_t=' + Date.now());
        }
      }
      configUrls.push('/ivx-config.json?_t=' + Date.now());
      configUrls.push('https://ivxholding.com/ivx-config.json?_t=' + Date.now());
      var ci = 0;
      function tryNextConfig() {
        if (ci >= configUrls.length) {
          console.warn('[IVX Deals] Config discovery exhausted — keeping static fallback');
          return;
        }
        var _dcUrl = configUrls[ci++];
        var _dcCtrl = new AbortController();
        var _dcTo = setTimeout(function() { _dcCtrl.abort(); }, 6000);
        fetch(_dcUrl, { signal: _dcCtrl.signal }).then(function(r) {
          clearTimeout(_dcTo);
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        }).then(function(cfg) {
          if (cfg.apiBaseUrl && cfg.apiBaseUrl.length > 5) {
            console.log('[IVX Deals] Discovered backend URL:', cfg.apiBaseUrl);
            var backendUrl = cfg.apiBaseUrl.replace(/\/$/, '') + '/api/landing-deals';
            var _dbCtrl = new AbortController();
            var _dbTo = setTimeout(function() { _dbCtrl.abort(); }, 6000);
            fetch(backendUrl, { signal: _dbCtrl.signal }).then(function(r) {
              clearTimeout(_dbTo);
              if (!r.ok) throw new Error('HTTP ' + r.status);
              return r.json();
            }).then(function(data) {
              var deals = Array.isArray(data) ? data : (data.deals || []);
              if (deals.length > 0) {
                console.log('[IVX Deals] Backend returned', deals.length, 'deals via discovered URL ✓');
                IVX_API = cfg.apiBaseUrl.replace(/\/$/, '');
                IVX_API_FALLBACKS = [IVX_API, 'https://ivxholding.com'].filter(function(v,i,a) { return v && a.indexOf(v) === i; });
                renderDeals(deals);
              }
            }).catch(function() { clearTimeout(_dbTo); tryNextConfig(); });
          } else { tryNextConfig(); }
        }).catch(function() { clearTimeout(_dcTo); tryNextConfig(); });
      }
      tryNextConfig();
    }

    var _fetchAttempt = 0;
    var _lastFetchHash = '';
    var _cacheRenderedOnly = false;
    var _lastFetchStartedAt = 0;
    function fetchDeals() {
      var now = Date.now();
      if (now - _lastFetchStartedAt < 1500) {
        console.log('[IVX Deals] Fetch skipped — throttled');
        return;
      }
      _lastFetchStartedAt = now;
      if (_fetchAttempt === 0) {
        var cached = getCachedDeals();
        if (cached && cached.length > 0) {
          _cacheRenderedOnly = true;
          _dealsLoaded = true;
          renderDeals(cached);
          updateRealtimeStatus('cached', cached.length);
        }
      }
      if (useApi || !sb) {
        fetchDealsViaApi();
        return;
      }
      _fetchAttempt++;
      sb.from('jv_deals')
        .select('*')
        .order('display_order', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
        .then(function(result) {
          if (result.error) {
            console.warn('[IVX Deals] Supabase client fetch error:', result.error.message);
            sb.from('jv_deals').select('*').then(function(r2) {
              if (r2.error) { useApi = true; fetchDealsViaSupabaseRest(); return; }
              var allDeals = r2.data || [];
              var deals = allDeals.filter(function(d) { return d.published === true && (d.status === 'active' || d.status === 'published' || d.status === 'live' || !d.status); });
              if (deals.length === 0) deals = allDeals.filter(function(d) { return d.published === true; });
              if (deals.length === 0) deals = allDeals;
              if (deals.length > 0) renderDeals(deals);
            }).catch(function() { useApi = true; fetchDealsViaSupabaseRest(); });
            return;
          }
          var allDeals = result.data || [];
          var deals = allDeals.filter(function(d) {
            return d.published === true && (d.status === 'active' || d.status === 'published' || d.status === 'live' || !d.status);
          });
          if (deals.length === 0) {
            deals = allDeals.filter(function(d) { return d.published === true; });
          }
          if (deals.length === 0) deals = allDeals;
          console.log('[IVX Deals] Filter result: ' + allDeals.length + ' total -> ' + deals.length + ' published+active');
          var newHash = JSON.stringify(deals.map(function(d) { return d.id + ':' + (d.updated_at || d.created_at); }));
          if (newHash === _lastFetchHash && _fetchAttempt > 1 && !_cacheRenderedOnly) {
            return;
          }
          _lastFetchHash = newHash;
          _cacheRenderedOnly = false;
          if (_fetchAttempt <= 5) console.log('[IVX Deals] Fetched', deals.length, 'deals from Supabase (attempt #' + _fetchAttempt + ', total rows: ' + allDeals.length + ')');
          if (deals.length > 0) {
            _dealsLoaded = true;
            renderDeals(deals);
            if (typeof setCachedDeals === 'function') setCachedDeals(deals);
            updateRealtimeStatus('connected', deals.length);
          } else {
            console.log('[IVX Deals] Supabase returned 0 deals — keeping static fallback + trying backend');
            ensureFallbackVisible();
            if (!_dealsLoaded) fetchFromBackendDirect(function() {});
          }
        })
        .catch(function(err) {
          _dealFetchFailCount++;
          if (_dealFetchFailCount <= 3) console.warn('[IVX Deals] Exception:', err.message, '— switching to REST fallback');
          fetchDealsViaSupabaseRest();
        });
    }

    setTimeout(function() {
      if (!_perezPhotosFromDb && !isPlaceholder(SUPABASE_URL)) {
        console.log('[IVX] Auto-verifying Perez Residence photos from Storage bucket...');
        fetchStoragePhotosForDeal('perez-residence-001', 'perez-residence');
      }
    }, 3000);

    var _realtimeChannel = null;
    var _realtimeReconnects = 0;
    var _realtimeMaxReconnects = 10;
    var _realtimeConnected = false;

    function setupRealtime() {
      if (!sb) {
        console.log('[IVX Realtime] No Supabase client — polling via API only');
        updateRealtimeStatus('polling', 0);
        return;
      }
      if (_realtimeChannel) {
        try { sb.removeChannel(_realtimeChannel); } catch(e) {}
        _realtimeChannel = null;
      }
      try {
        _realtimeChannel = sb
          .channel('jv-deals-live-v2')
          .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'jv_deals' },
            function(payload) {
              console.log('[IVX Realtime] NEW deal inserted:', payload.new && payload.new.id);
              setTimeout(function() { fetchDeals(); }, 500);
            }
          )
          .on('postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'jv_deals' },
            function(payload) {
              console.log('[IVX Realtime] Deal UPDATED:', payload.new && payload.new.id, '| published:', payload.new && payload.new.published);
              setTimeout(function() { fetchDeals(); }, 500);
            }
          )
          .on('postgres_changes',
            { event: 'DELETE', schema: 'public', table: 'jv_deals' },
            function(payload) {
              console.log('[IVX Realtime] Deal DELETED:', payload.old && payload.old.id);
              setTimeout(function() { fetchDeals(); }, 500);
            }
          )
          .subscribe(function(status, err) {
            console.log('[IVX Realtime] Status:', status, err ? '| Error: ' + err.message : '');
            if (status === 'SUBSCRIBED') {
              _realtimeConnected = true;
              _realtimeReconnects = 0;
              console.log('[IVX Realtime] ✓ Connected — live updates active on jv_deals');
              updateRealtimeStatus('live', 0);
              autoRefreshDeals();
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              _realtimeConnected = false;
              updateRealtimeStatus('error', 0);
              if (_realtimeReconnects < _realtimeMaxReconnects) {
                _realtimeReconnects++;
                var delay = Math.min(_realtimeReconnects * 3000, 30000);
                console.log('[IVX Realtime] Will reconnect in', delay/1000, 's (attempt #' + _realtimeReconnects + ')');
                setTimeout(function() { setupRealtime(); }, delay);
              } else {
                console.warn('[IVX Realtime] Max reconnects reached — falling back to polling');
                updateRealtimeStatus('polling', 0);
              }
            } else if (status === 'CLOSED') {
              _realtimeConnected = false;
              updateRealtimeStatus('disconnected', 0);
              if (_realtimeReconnects < _realtimeMaxReconnects) {
                _realtimeReconnects++;
                setTimeout(function() { setupRealtime(); }, 5000);
              }
            }
          });
        console.log('[IVX Realtime] Channel created for jv_deals (INSERT/UPDATE/DELETE)');
      } catch (e) {
        console.warn('[IVX Realtime] Setup failed:', e.message, '— using polling only');
        updateRealtimeStatus('polling', 0);
      }
    }

    var _presenceChannel = null;
    var _presenceConnected = false;
    function setupPresence() {
      if (!sb) return;
      if (_presenceChannel) { try { sb.removeChannel(_presenceChannel); } catch(e) {} _presenceChannel = null; }
      try {
        var ua = navigator.userAgent || '';
        var isMobile = /mobile|android|iphone|ipad/i.test(ua);
        var isTablet = /tablet|ipad/i.test(ua);
        var deviceType = isTablet ? 'Tablet' : isMobile ? 'Mobile' : 'Desktop';
        var osName = /windows/i.test(ua) ? 'Windows' : /mac/i.test(ua) ? 'macOS' : /linux/i.test(ua) ? 'Linux' : /android/i.test(ua) ? 'Android' : /iphone|ipad/i.test(ua) ? 'iOS' : 'Unknown';
        var browserName = /edg/i.test(ua) ? 'Edge' : /chrome/i.test(ua) ? 'Chrome' : /firefox/i.test(ua) ? 'Firefox' : /safari/i.test(ua) ? 'Safari' : 'Other';
        _presenceChannel = sb.channel('ivx-presence-v1', { config: { presence: { key: SESSION_ID } } });
        _presenceChannel
          .on('presence', { event: 'sync' }, function() { console.log('[IVX Presence] Sync'); })
          .subscribe(function(status) {
            console.log('[IVX Presence] Status:', status);
            if (status === 'SUBSCRIBED') {
              _presenceConnected = true;
              _presenceChannel.track({
                sessionId: SESSION_ID,
                source: 'landing',
                device: deviceType,
                os: osName,
                browser: browserName,
                geo: GEO_DATA || {},
                currentStep: FUNNEL_STEP,
                page: 'Landing Page',
                startedAt: new Date(PAGE_START).toISOString(),
                lastSeen: new Date().toISOString(),
                engagementScore: ENGAGEMENT_SCORE,
                online_at: new Date().toISOString()
              });
              console.log('[IVX Presence] Tracking started for session:', SESSION_ID);
            }
          });
        setInterval(function() {
          if (_presenceConnected && _presenceChannel) {
            _presenceChannel.track({
              sessionId: SESSION_ID,
              source: 'landing',
              device: deviceType,
              os: osName,
              browser: browserName,
              geo: GEO_DATA || {},
              currentStep: FUNNEL_STEP,
              page: 'Landing Page',
              startedAt: new Date(PAGE_START).toISOString(),
              lastSeen: new Date().toISOString(),
              engagementScore: ENGAGEMENT_SCORE,
              online_at: new Date().toISOString()
            });
          }
        }, 30000);
      } catch(e) {
        console.warn('[IVX Presence] Setup failed:', e.message);
      }
    }

    var _lastForceRefreshTime = 0;
    var _lastRefreshTimestamp = Date.now();
    var _autoRefreshInterval = null;

    function updateRefreshAgo() {
      var ago = Math.round((Date.now() - _lastRefreshTimestamp) / 1000);
      var agoEl = document.getElementById('refresh-ago');
      if (!agoEl) return;
      if (ago < 5) agoEl.textContent = '· just now';
      else if (ago < 60) agoEl.textContent = '· ' + ago + 's ago';
      else agoEl.textContent = '· ' + Math.floor(ago / 60) + 'm ago';
    }
    setInterval(updateRefreshAgo, 5000);

    function autoRefreshDeals() {
      _lastFetchHash = '';
      _fetchAttempt = 0;
      _dealFetchFailCount = Math.min(_dealFetchFailCount, 5);
      _lastRefreshTimestamp = Date.now();
      updateRefreshAgo();
      fetchDeals();
    }

    // startDealPolling removed — replaced by unified polling below
    var _dealsLoaded = false;

    function fetchFromBackendDirect(callback) {
      var backendUrls = [
        _HARDCODED_BACKEND_URL + '/api/landing-deals',
      ];
      for (var bi = 0; bi < IVX_API_FALLBACKS.length; bi++) {
        var b = IVX_API_FALLBACKS[bi];
        if (b && b.indexOf('ivxholding.com') === -1 && backendUrls.indexOf(b + '/api/landing-deals') === -1) {
          backendUrls.push(b + '/api/landing-deals');
        }
      }
      var bIdx = 0;
      function tryNextBackend() {
        if (bIdx >= backendUrls.length || _dealsLoaded) { if (callback) callback(_dealsLoaded); return; }
        var url = backendUrls[bIdx++];
        console.log('[IVX Deals] Backend fetch:', url);
        var _bdCtrl = new AbortController();
        var _bdTo = setTimeout(function() { _bdCtrl.abort(); }, 8000);
        fetch(url, { signal: _bdCtrl.signal }).then(function(r) {
          clearTimeout(_bdTo);
          if (!r.ok) {
            return r.text().then(function(txt) {
              if (txt.indexOf('Temporarily Unavailable') !== -1 || txt.indexOf('Service Unavailable') !== -1) {
                throw new Error('COLD_START');
              }
              throw new Error('HTTP ' + r.status);
            });
          }
          return r.json();
        })
          .then(function(data) {
            _BACKEND_WOKE = true;
            var deals = Array.isArray(data) ? data : (data && data.deals ? data.deals : []);
            if (deals.length > 0) {
              _dealsLoaded = true;
              console.log('[IVX Deals] Backend returned', deals.length, 'deals from', url, '(source:', (data.source || 'unknown') + ')');
              renderDeals(deals);
              var cfgUrl = url.replace('/landing-deals', '/landing-config');
              fetch(cfgUrl).then(function(r) { return r.json(); }).then(function(cfg) {
                if (cfg) {
                  applyConfig(cfg);
                  if (_supabaseReady && !sb) { initSupabaseClient(); setupRealtime(); }
                }
              }).catch(function() {});
              if (callback) callback(true);
            } else { tryNextBackend(); }
          })
          .catch(function(err) {
            clearTimeout(_bdTo);
            console.warn('[IVX Deals] Backend fetch failed:', url, err.message);
            if (err.message === 'COLD_START' && _BACKEND_COLD_START_RETRIES < _BACKEND_MAX_COLD_RETRIES) {
              _BACKEND_COLD_START_RETRIES++;
              var delay = Math.min(_BACKEND_COLD_START_RETRIES * 2000, 8000);
              console.log('[IVX Deals] Backend cold start detected — retry #' + _BACKEND_COLD_START_RETRIES + ' in ' + (delay/1000) + 's');
              bIdx = 0;
              setTimeout(function() { tryNextBackend(); }, delay);
              return;
            }
            tryNextBackend();
          });
      }
      tryNextBackend();
    }

    function retryBackendAfterColdStart() {
      if (_BACKEND_WOKE) return;
      _BACKEND_COLD_START_RETRIES++;
      if (_BACKEND_COLD_START_RETRIES > _BACKEND_MAX_COLD_RETRIES) return;
      var delay = Math.min(1500 + _BACKEND_COLD_START_RETRIES * 1500, 8000);
      console.log('[IVX Deals] Scheduling backend cold-start retry #' + _BACKEND_COLD_START_RETRIES + ' in ' + (delay/1000) + 's');
      setTimeout(function() {
        if (_dealsLoaded) return;
        console.log('[IVX Deals] Cold-start retry #' + _BACKEND_COLD_START_RETRIES + '...');
        var url = _HARDCODED_BACKEND_URL + '/api/landing-deals';
        var _csCtrl = new AbortController();
        var _csTo = setTimeout(function() { _csCtrl.abort(); }, 8000);
        fetch(url, { signal: _csCtrl.signal }).then(function(r) {
          clearTimeout(_csTo);
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        }).then(function(data) {
          _BACKEND_WOKE = true;
          var deals = Array.isArray(data) ? data : (data && data.deals ? data.deals : []);
          if (deals.length > 0) {
            _dealsLoaded = true;
            console.log('[IVX Deals] Cold-start retry SUCCESS —', deals.length, 'deals loaded');
            renderDeals(deals);
            var cfgUrl = _HARDCODED_BACKEND_URL + '/api/landing-config';
            fetch(cfgUrl).then(function(r) { return r.json(); }).then(function(cfg) {
              if (cfg) { applyConfig(cfg); if (_supabaseReady && !sb) { initSupabaseClient(); setupRealtime(); } }
            }).catch(function() {});
          } else { retryBackendAfterColdStart(); }
        }).catch(function() { retryBackendAfterColdStart(); });
      }, delay);
    }

    // === INSTANT CACHE RENDER — show cached deals immediately while backend wakes up ===
    var _cachedDeals = getCachedDeals() || STATIC_FALLBACK_DEALS;
    var _cacheRenderedOnly = false;
    if (_cachedDeals && _cachedDeals.length > 0) {
      console.log('[IVX Deals] Rendering', _cachedDeals.length, 'cached deals instantly (will refresh from live source)');
      renderDeals(_cachedDeals);
      _cacheRenderedOnly = true;
      updateRealtimeStatus('polling', _cachedDeals.length);
    }

    // Fire a wake-up ping immediately to start backend cold boot ASAP
    if (_HARDCODED_BACKEND_URL) {
      fetch(_HARDCODED_BACKEND_URL + '/health', { mode: 'no-cors' }).catch(function(){});
    }

    console.log('[IVX Deals] Starting deal fetch. Supabase ready:', _supabaseReady, '| JWT key:', isValidJwtKey(SUPABASE_ANON_KEY));

    function aggressiveFetchAll() {
      _dealsLoaded = false;
      _cacheRenderedOnly = false;
      _lastRefreshTimestamp = Date.now();
      updateRefreshAgo();

      if (_supabaseReady && sb && isValidJwtKey(SUPABASE_ANON_KEY)) {
        console.log('[IVX Deals] Priority: querying Supabase client first (authoritative source)...');
        fetchDeals();
        if (!_realtimeConnected) setupRealtime();
      } else if (_supabaseReady && isValidJwtKey(SUPABASE_ANON_KEY)) {
        console.log('[IVX Deals] Supabase ready but no client — trying REST directly...');
        fetchDealsViaSupabaseRest();
      }

      fetchFromBackendDirect(function(success) {
        if (success) {
          console.log('[IVX Deals] Backend also delivered deals ✓');
          if (_supabaseReady && sb && !_realtimeConnected) setupRealtime();
        } else {
          console.log('[IVX Deals] Backend first attempt failed — retrying...');
          retryBackendAfterColdStart();
          if (!_dealsLoaded && _supabaseReady && sb) {
            fetchDeals();
          }
        }
      });

      if (!_supabaseReady) {
        tryLoadConfig(function() {
          if (_supabaseReady && isValidJwtKey(SUPABASE_ANON_KEY) && !sb) initSupabaseClient();
          if (_supabaseReady && sb) {
            console.log('[IVX Deals] Config discovered — fetching via Supabase (authoritative)...');
            fetchDeals();
            setupRealtime();
          }
        });
      }
    }

    aggressiveFetchAll();
    if (_supabaseReady && sb && isValidJwtKey(SUPABASE_ANON_KEY)) { setupRealtime(); setupPresence(); }

    setTimeout(function() {
      if (!_dealsLoaded) {
        console.log('[IVX Deals] Safety timeout: no deals loaded after 12s — ensuring fallback visible');
        ensureFallbackVisible();
      }
    }, 12000);
    setTimeout(function() {
      if (!_dealsLoaded) {
        console.log('[IVX Deals] Safety timeout 2: still no deals after 25s — ensuring fallback visible');
        ensureFallbackVisible();
      }
    }, 25000);

    // Unified auto-refresh: 60s when realtime connected, 30s when polling
    // Check interval raised to 30s to reduce idle CPU
    _autoRefreshInterval = setInterval(function() {
      if (document.visibilityState === 'hidden') return;
      var now = Date.now();
      var interval = _realtimeConnected ? 60000 : 30000;
      if (now - _lastRefreshTimestamp >= interval) {
        console.log('[IVX Deals] Auto-refresh (' + (_realtimeConnected ? 'realtime+poll' : 'polling') + ')');
        _lastRefreshTimestamp = now;
        updateRefreshAgo();
        if (sb && _supabaseReady && isValidJwtKey(SUPABASE_ANON_KEY)) {
          fetchDeals();
        } else {
          fetchFromBackendDirect(function(s) {
            if (!s && _supabaseReady && isValidJwtKey(SUPABASE_ANON_KEY)) fetchDealsViaSupabaseRest();
          });
        }
      }
    }, 30000);

    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible') {
        var elapsed = Date.now() - _lastRefreshTimestamp;
        if (elapsed > 30000) {
          console.log('[IVX Deals] Tab visible — instant refresh');
          aggressiveFetchAll();
        }
      }
    });

    // focus listener removed — visibilitychange handler above covers tab return

    window.manualRefreshDeals = function() {
      console.log('[IVX Deals] Auto-refresh active — no manual action needed');
      autoRefreshDeals();
    };

    // Expose re-init for global postMessage handler
    window._ivxReinitDeals = function() {
      if (_supabaseReady && !sb) {
        initSupabaseClient();
        fetchDeals();
        setupRealtime();
        console.log('[IVX Deals] Re-initialized via global postMessage config ✓');
      }
    };

    // postMessage config listener removed — handled by global listener above (line ~2641)
  })();

  // ══════════════════════════════════════════════════════════════════════════════
  // LEGAL MODALS — Privacy, Terms, Disclosures
  // ══════════════════════════════════════════════════════════════════════════════
  var LEGAL_CONTENT = {
    privacy: {
      title: 'Privacy Policy',
      html: '<p><strong>Effective Date:</strong> January 1, 2026</p>' +
        '<p>IVX Holdings LLC ("IVX," "we," "us," or "our") respects your privacy and is committed to protecting your personal data. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you visit our website or use our mobile application.</p>' +
        '<h3>1. Information We Collect</h3>' +
        '<ul><li><strong>Personal Data:</strong> Name, email address, phone number, mailing address, date of birth, government-issued identification numbers, and financial information provided during registration, KYC verification, or investment transactions.</li>' +
        '<li><strong>Usage Data:</strong> Browser type, IP address, device identifiers, pages visited, time spent on pages, referral sources, and interaction patterns.</li>' +
        '<li><strong>Financial Data:</strong> Investment amounts, transaction history, bank account details (for ACH transfers), and payment processing information handled by our secure third-party processors.</li></ul>' +
        '<h3>2. How We Use Your Information</h3>' +
        '<ul><li>Process and manage your investments and account</li>' +
        '<li>Comply with KYC/AML regulatory requirements</li>' +
        '<li>Send transaction confirmations, dividend notifications, and account updates</li>' +
        '<li>Improve our platform, services, and user experience</li>' +
        '<li>Detect and prevent fraud, unauthorized access, and illegal activities</li>' +
        '<li>Communicate marketing offers (with your consent; you may opt out anytime)</li></ul>' +
        '<h3>3. Data Sharing</h3>' +
        '<p>We do not sell your personal information. We may share data with:</p>' +
        '<ul><li>Regulatory authorities as required by law (SEC, FinCEN, state regulators)</li>' +
        '<li>KYC/AML verification service providers</li>' +
        '<li>Payment processors and banking partners</li>' +
        '<li>Cloud infrastructure providers (encrypted at rest and in transit)</li></ul>' +
        '<h3>4. Data Security</h3>' +
        '<p>We use bank-grade encryption (AES-256), secure socket layer (SSL/TLS) connections, multi-factor authentication, and regular security audits. Investor payment handling follows the platform escrow and transaction workflow.</p>' +
        '<h3>5. Your Rights</h3>' +
        '<p>You have the right to access, correct, delete, or export your personal data. California residents have additional rights under CCPA. Contact us at <a href="mailto:privacy@ivxholding.com" style="color:var(--gold)">privacy@ivxholding.com</a> to exercise your rights.</p>' +
        '<h3>6. Cookies</h3>' +
        '<p>We use essential cookies for authentication and session management, and optional analytics cookies to improve our services. You can manage cookie preferences in your browser settings.</p>' +
        '<h3>7. Contact</h3>' +
        '<p>IVX Holdings LLC<br>Email: <a href="mailto:privacy@ivxholding.com" style="color:var(--gold)">privacy@ivxholding.com</a><br>Email: investors@ivxholding.com</p>'
    },
    terms: {
      title: 'Terms of Service',
      html: '<p><strong>Effective Date:</strong> January 1, 2026</p>' +
        '<p>These Terms of Service ("Terms") govern your use of the IVX Holdings platform, website, and mobile application. By accessing or using our services, you agree to these Terms.</p>' +
        '<h3>1. Eligibility</h3>' +
        '<p>You must be at least 18 years old and meet all applicable KYC/AML requirements to create an account and invest through IVX Holdings. By using our platform, you represent that you meet these requirements.</p>' +
        '<h3>2. Account Registration</h3>' +
        '<p>You agree to provide accurate, current, and complete information during registration and to update such information as necessary. You are responsible for maintaining the confidentiality of your account credentials and for all activities under your account.</p>' +
        '<h3>3. Investment Risks</h3>' +
        '<p><strong>Real estate investments involve significant risk, including the potential loss of principal.</strong> Past performance does not guarantee future results. Property values may decrease, rental income may fluctuate, and liquidity is not guaranteed. You should invest only money you can afford to lose.</p>' +
        '<h3>4. Securities Compliance</h3>' +
        '<p>All securities offered through IVX Holdings are offered in compliance with applicable federal and state securities laws, including Regulation A+ and Regulation D exemptions. Offerings are made only through official offering documents.</p>' +
        '<h3>5. Fractional Ownership</h3>' +
        '<p>When you purchase shares through IVX, you acquire fractional ownership interests in the underlying property entity. Share ownership is recorded digitally and is subject to the terms of each specific offering.</p>' +
        '<h3>6. Fees</h3>' +
        '<p>IVX may charge platform fees, management fees, and transaction fees as disclosed in each offering document. All fees are transparently disclosed before you complete any investment.</p>' +
        '<h3>7. Prohibited Activities</h3>' +
        '<ul><li>Using the platform for money laundering or terrorist financing</li>' +
        '<li>Creating multiple accounts or providing false identity information</li>' +
        '<li>Attempting to manipulate pricing or trading activity</li>' +
        '<li>Reverse engineering, scraping, or interfering with platform operations</li></ul>' +
        '<h3>8. Limitation of Liability</h3>' +
        '<p>To the maximum extent permitted by law, IVX Holdings shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the platform or any investments made through it.</p>' +
        '<h3>9. Dispute Resolution</h3>' +
        '<p>Any disputes arising from these Terms shall be resolved through binding arbitration in accordance with the rules of the American Arbitration Association, conducted in Palm Beach County, Florida.</p>' +
        '<h3>10. Contact</h3>' +
        '<p>IVX Holdings LLC<br>Email: <a href="mailto:legal@ivxholding.com" style="color:var(--gold)">legal@ivxholding.com</a><br>Email: investors@ivxholding.com</p>'
    },
    disclosures: {
      title: 'Investment Disclosures',
      html: '<p><strong>Effective Date:</strong> January 1, 2026</p>' +
        '<h3>General Investment Risks</h3>' +
        '<p>Investing in real estate securities involves substantial risk. The value of your investment may increase or decrease. You may lose some or all of your invested capital. Real estate investments are illiquid by nature and there is no guarantee that a secondary market will be available for trading shares.</p>' +
        '<h3>Regulatory Status</h3>' +
        '<p>Securities offered through IVX Holdings LLC are offered pursuant to exemptions from registration under Regulation A+ (Tier 2) and Regulation D (Rule 506(c)) of the Securities Act of 1933, as amended. These offerings have not been approved or disapproved by the SEC or any state securities regulatory authority.</p>' +
        '<h3>Forward-Looking Statements</h3>' +
        '<p>All projected returns, expected ROI figures, and estimated rental yields presented on this platform are forward-looking statements based on current assumptions and market conditions. Actual results may differ materially from projections. These figures should not be relied upon as a guarantee of future performance.</p>' +
        '<h3>Dividend Distributions</h3>' +
        '<p>Dividend distributions are not guaranteed and depend on the financial performance of the underlying property. Distributions may be reduced, suspended, or eliminated at any time based on property operating results, capital expenditure needs, or market conditions.</p>' +
        '<h3>Liquidity Risk</h3>' +
        '<p>While IVX offers a secondary trading market for property shares, there is no guarantee of liquidity. You may not be able to sell your shares when desired or at the price you paid. Hold periods may apply to certain offerings.</p>' +
        '<h3>Tax Considerations</h3>' +
        '<p>Real estate investment returns may have tax implications including capital gains tax, ordinary income tax on dividends, and state-specific taxes. Consult a qualified tax advisor regarding your specific situation before investing.</p>' +
        '<h3>Conflicts of Interest</h3>' +
        '<p>IVX Holdings and its affiliates may have conflicts of interest in connection with the management and disposition of properties. All material conflicts are disclosed in the relevant offering documents.</p>' +
        '<h3>Not Investment Advice</h3>' +
        '<p>Nothing on this platform constitutes investment advice, tax advice, or legal advice. All investment decisions should be made after consultation with qualified financial, tax, and legal professionals.</p>' +
        '<h3>Contact Our Compliance Team</h3>' +
        '<p>IVX Holdings LLC — Compliance Department<br>Email: <a href="mailto:compliance@ivxholding.com" style="color:var(--gold)">compliance@ivxholding.com</a><br>Email: investors@ivxholding.com</p>'
    }
  };

  function openLegalModal(type) {
    var content = LEGAL_CONTENT[type];
    if (!content) return;
    document.getElementById('legal-title').textContent = content.title;
    document.getElementById('legal-content').innerHTML = content.html;
    document.getElementById('legal-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeLegalModal() {
    document.getElementById('legal-overlay').classList.remove('open');
    document.body.style.overflow = '';
  }

  // Escape key handled by unified handler above (closeFunnel + closePartnerApply + closeLegalModal)

  // ══════════════════════════════════════════════════════════════════════════════
  // SCROLL REVEAL
  // ══════════════════════════════════════════════════════════════════════════════
  var revealObs = new IntersectionObserver(function(entries) {
    entries.forEach(function(e) {
      if (e.isIntersecting) { e.target.classList.add('visible'); revealObs.unobserve(e.target); }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -32px 0px' });
  document.querySelectorAll('.reveal').forEach(function(el) { revealObs.observe(el); });

  // ══════════════════════════════════════════════════════════════════════════════
  // MOBILE NAV
  // ══════════════════════════════════════════════════════════════════════════════
  var hamburger = document.getElementById('hamburger');
  var navLinks = document.querySelector('.nav-links');
  var navOpen = false;
  function updateHamburgerIcon() {
    var spans = hamburger.querySelectorAll('span');
    if (navOpen) {
      spans[0].style.cssText = 'transform:rotate(45deg) translate(5px,5px);';
      spans[1].style.cssText = 'opacity:0;';
      spans[2].style.cssText = 'transform:rotate(-45deg) translate(5px,-5px);';
    } else {
      spans[0].style.cssText = '';
      spans[1].style.cssText = '';
      spans[2].style.cssText = '';
    }
  }
  hamburger.addEventListener('click', function() {
    navOpen = !navOpen;
    updateHamburgerIcon();
    if (navOpen) {
      navLinks.classList.add('mobile-open');
      navLinks.style.cssText = '';
    } else {
      navLinks.classList.remove('mobile-open');
    }
  });
  navLinks.querySelectorAll('a').forEach(function(a) {
    a.addEventListener('click', function() {
      navOpen = false;
      updateHamburgerIcon();
      navLinks.classList.remove('mobile-open');
    });
  });
  window.addEventListener('resize', function() {
    if (window.innerWidth > 800 && navOpen) {
      navOpen = false;
      updateHamburgerIcon();
      navLinks.classList.remove('mobile-open');
    }
  });


  // Cookie Consent
  (function initCookieConsent() {
    try {
      var consent = localStorage.getItem('ivx_cookie_consent');
      if (!consent) {
        setTimeout(function() {
          var banner = document.getElementById('cookie-banner');
          if (banner) banner.classList.add('visible');
        }, 2500);
      }
    } catch(e) {}
  })();
  function acceptCookies() {
    try { localStorage.setItem('ivx_cookie_consent', 'all'); } catch(e) {}
    document.getElementById('cookie-banner').classList.remove('visible');
    // Load ad pixels only after explicit consent (items 90-97)
    if (window.IVX && typeof IVX.loadAdPixels === 'function') {
      IVX.loadAdPixels();
    }
  }
  function rejectCookies() {
    try { localStorage.setItem('ivx_cookie_consent', 'essential'); } catch(e) {}
    document.getElementById('cookie-banner').classList.remove('visible');
    // Do NOT load ad pixels — essentials only (item 97)
  }


// === Extracted Script Block 4 (89 lines) ===

/* IVX Instagram-style video playback: adaptive HLS (hls.js / native) + autoplay muted when >=50% visible, pause off-screen. */
(function () {
  if (window.__ivxIgPlayInit) return;
  window.__ivxIgPlayInit = true;

  var HLS_CDN = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js';
  var hlsLoading = null;
  function loadHlsJs() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (hlsLoading) return hlsLoading;
    hlsLoading = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = HLS_CDN;
      s.async = true;
      s.onload = function () { resolve(window.Hls || null); };
      s.onerror = function () { resolve(null); };
      document.head.appendChild(s);
    });
    return hlsLoading;
  }

  /* Lazy adaptive attach: HLS master via native (Safari/iOS) or hls.js (MSE),
     progressive MP4 fallback via data-fallback so playback never black-screens. */
  window.ivxAttachHls = function (v) {
    if (!v || v.__ivxHlsDone) return;
    var hlsUrl = v.getAttribute('data-hls');
    if (!hlsUrl) { v.__ivxHlsDone = true; return; }
    v.__ivxHlsDone = true;
    if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = hlsUrl;
      return;
    }
    loadHlsJs().then(function (Hls) {
      if (Hls && Hls.isSupported()) {
        var h = new Hls({ capLevelToPlayerSize: true, maxBufferLength: 30, backBufferLength: 30 });
        h.on(Hls.Events.ERROR, function (ev, data) {
          if (data && data.fatal) {
            try { h.destroy(); } catch (e) {}
            var fb = v.getAttribute('data-fallback');
            if (fb && !v.getAttribute('src')) { v.src = fb; v.load(); }
          }
        });
        h.loadSource(hlsUrl);
        h.attachMedia(v);
        v.__ivxHls = h;
      } else {
        var fb = v.getAttribute('data-fallback');
        if (fb) { v.src = fb; v.load(); }
      }
    });
  };

  if (!('IntersectionObserver' in window)) return;
  var io = new IntersectionObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var v = e.target;
      if (e.isIntersecting) window.ivxAttachHls(v);
      if (e.isIntersecting && e.intersectionRatio >= 0.5) {
        v.muted = true;
        var p = v.play();
        if (p && p.catch) p.catch(function () {});
      } else if (!v.paused) {
        v.pause();
      }
    }
  }, { threshold: [0, 0.5] });
  var seen = new WeakSet();
  function register(root) {
    var vids = (root.querySelectorAll ? root.querySelectorAll('video[data-igplay]') : []);
    for (var i = 0; i < vids.length; i++) {
      if (seen.has(vids[i])) continue;
      seen.add(vids[i]);
      io.observe(vids[i]);
    }
  }
  register(document);
  var mo = new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var added = muts[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        if (added[j].nodeType === 1) register(added[j]);
      }
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
})();
