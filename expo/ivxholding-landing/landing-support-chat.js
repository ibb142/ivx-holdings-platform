(function () {
  var QUICK_REPLIES = [
    'How do I invest?',
    'Frontend or app issue',
    'AWS or backend support',
    'ChatGPT integration help',
    'Speak with management'
  ];

  var state = {
    initialized: false,
    busy: false,
    client: null,
    messages: [],
    videoPolls: {}
  };

  var VIDEO_POLL_INTERVAL_MS = 3000;
  var VIDEO_POLL_MAX_MS = 15 * 60 * 1000;

  function isPlaceholder(value) {
    return !value || value.indexOf('__IVX_') === 0 || value.length < 10;
  }

  function getMeta(name) {
    var element = document.querySelector('meta[name="' + name + '"]');
    return element ? String(element.content || '').trim() : '';
  }

  function getSupabaseConfig() {
    var url = getMeta('ivx-sb-url');
    var key = getMeta('ivx-sb-key');

    if (isPlaceholder(url)) {
      url = getMeta('ivx-sb-url-fallback');
    }

    if (isPlaceholder(key)) {
      key = getMeta('ivx-sb-key-fallback');
    }

    if (isPlaceholder(url) || isPlaceholder(key)) {
      try {
        var cached = JSON.parse(localStorage.getItem('ivx_sb_config') || '{}');
        if (cached && cached.url && !isPlaceholder(cached.url)) {
          url = cached.url;
        }
        if (cached && cached.key && !isPlaceholder(cached.key)) {
          key = cached.key;
        }
      } catch (error) {
        console.warn('[IVX Landing Chat] Cached config read failed:', error && error.message ? error.message : error);
      }
    }

    return { url: url, key: key };
  }

  function getBackendUrl() {
    var url = getMeta('ivx-backend-url');
    if (isPlaceholder(url)) {
      try {
        var cached = JSON.parse(localStorage.getItem('ivx_backend_url') || '""');
        if (cached && !isPlaceholder(cached)) url = cached;
      } catch (error) { /* noop */ }
    }
    if (isPlaceholder(url)) {
      url = 'https://api.ivxholding.com';
    }
    return String(url || '').replace(/\/+$/, '');
  }

  function getClient() {
    if (state.client) {
      return state.client;
    }

    var config = getSupabaseConfig();
    if (!window.supabase || isPlaceholder(config.url) || isPlaceholder(config.key)) {
      return null;
    }

    try {
      state.client = window.supabase.createClient(config.url, config.key);
      return state.client;
    } catch (error) {
      console.warn('[IVX Landing Chat] Supabase client init failed:', error && error.message ? error.message : error);
      return null;
    }
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, function (character) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[character] || character;
    });
  }

  function formatTime(value) {
    try {
      return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  function buildMessage(role, text) {
    return {
      id: 'landing-chat-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      role: role,
      text: text,
      timestamp: new Date().toISOString()
    };
  }

  function getElements() {
    return {
      shell: document.getElementById('landing-chat-shell'),
      messages: document.getElementById('landing-chat-messages'),
      input: document.getElementById('landing-chat-input'),
      send: document.getElementById('landing-chat-send'),
      human: document.getElementById('landing-chat-human'),
      statusDot: document.getElementById('landing-chat-status-dot'),
      statusTitle: document.getElementById('landing-chat-status-title'),
      statusSubtext: document.getElementById('landing-chat-status-subtext'),
      statusBadge: document.getElementById('landing-chat-status-live'),
      quickReplyButtons: document.querySelectorAll('.landing-chat-quick-reply')
    };
  }

  function setStatus(title, subtitle, tone) {
    var elements = getElements();
    if (!elements.statusTitle || !elements.statusSubtext || !elements.statusDot || !elements.statusBadge) {
      return;
    }

    elements.statusTitle.textContent = title;
    elements.statusSubtext.textContent = subtitle;
    elements.statusDot.className = 'landing-chat-status-dot ' + (tone === 'waiting' ? 'is-waiting' : tone === 'warning' ? 'is-warning' : 'is-connected');
    elements.statusBadge.className = 'landing-chat-status-live ' + (tone === 'warning' ? 'is-warning' : 'is-active');
    elements.statusBadge.textContent = tone === 'waiting'
      ? 'Working now'
      : tone === 'warning'
        ? 'Fallback + direct contact'
        : 'AI + human support';
  }

  function updateBusyState() {
    var elements = getElements();
    if (!elements.shell || !elements.send || !elements.human || !elements.input) {
      return;
    }

    elements.shell.classList.toggle('is-loading', state.busy);
    elements.send.disabled = state.busy;
    elements.human.disabled = state.busy;
    elements.input.disabled = state.busy;
    elements.send.textContent = state.busy ? 'Sending…' : 'Send →';
    elements.human.textContent = state.busy ? 'Working…' : 'Request Live Investor Support';
  }

  function renderMessages() {
    var elements = getElements();
    if (!elements.messages) {
      return;
    }

    elements.messages.innerHTML = state.messages.map(function (message) {
      var label = message.role === 'user' ? 'You' : 'IVX AI';
      var body = message.video
        ? renderVideoBody(message.video)
        : '<div class="landing-chat-message-copy">' + escapeHtml(message.text) + '</div>';
      return [
        '<div class="landing-chat-message ' + (message.role === 'user' ? 'is-user' : 'is-support') + '">',
        '<div class="landing-chat-message-label">' + label + '</div>',
        body,
        '<div class="landing-chat-message-meta">' + escapeHtml(formatTime(message.timestamp)) + '</div>',
        '</div>'
      ].join('');
    }).join('');

    elements.messages.scrollTop = elements.messages.scrollHeight;
  }

  /* Video bubble: never mounts a <video> in the list — only a lazy poster
     thumbnail; the player opens in a modal on tap (Instagram chat pattern). */
  function renderVideoBody(video) {
    if (video.status === 'uploading') {
      var pct = Math.max(0, Math.min(100, Math.round(video.progress || 0)));
      return '<div class="landing-chat-video is-pending">' +
        '<div class="landing-chat-video-state">Uploading video\u2026 ' + pct + '%</div>' +
        '<div class="landing-chat-video-bar"><div class="landing-chat-video-bar-fill" style="width:' + pct + '%"></div></div>' +
        '</div>';
    }
    if (video.status === 'processing' || video.status === 'uploaded') {
      return '<div class="landing-chat-video is-pending">' +
        '<div class="landing-chat-video-state"><span class="landing-chat-video-spinner"></span>Processing video\u2026 (' + escapeHtml(video.fileName || 'video') + ')</div>' +
        '<div class="landing-chat-video-hint">Optimizing for playback \u2014 1080p/720p/480p/360p</div>' +
        '</div>';
    }
    if (video.status === 'failed') {
      return '<div class="landing-chat-video is-failed">' +
        '<div class="landing-chat-video-state">Video processing failed</div>' +
        (video.error ? '<div class="landing-chat-video-hint">' + escapeHtml(String(video.error).slice(0, 160)) + '</div>' : '') +
        '<button type="button" class="landing-chat-video-retry" data-video-retry="' + escapeHtml(video.videoId) + '">Retry processing</button>' +
        '</div>';
    }
    var poster = video.posterUrl || video.thumbnailUrl || '';
    var duration = video.duration ? Math.round(video.duration) + 's' : '';
    return '<div class="landing-chat-video is-ready" data-video-open="' + escapeHtml(video.videoId) + '" role="button" tabindex="0" aria-label="Play video">' +
      (poster ? '<img class="landing-chat-video-thumb" src="' + escapeHtml(poster) + '" alt="Video thumbnail" loading="lazy" />' : '<div class="landing-chat-video-thumb landing-chat-video-thumb-empty"></div>') +
      '<div class="landing-chat-video-play">\u25B6</div>' +
      (duration ? '<div class="landing-chat-video-duration">' + duration + '</div>' : '') +
      '</div>';
  }

  function findVideoMessage(videoId) {
    for (var i = 0; i < state.messages.length; i++) {
      if (state.messages[i].video && state.messages[i].video.videoId === videoId) {
        return state.messages[i];
      }
    }
    return null;
  }

  function updateVideoMessage(videoId, patch) {
    var message = findVideoMessage(videoId);
    if (!message) return;
    for (var key in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) message.video[key] = patch[key];
    }
    renderMessages();
  }

  function pollVideoStatus(videoId) {
    var backend = getBackendUrl();
    if (!backend) return;
    var startedAt = Date.now();
    if (state.videoPolls[videoId]) clearInterval(state.videoPolls[videoId]);
    state.videoPolls[videoId] = setInterval(function () {
      if (Date.now() - startedAt > VIDEO_POLL_MAX_MS) {
        clearInterval(state.videoPolls[videoId]);
        delete state.videoPolls[videoId];
        updateVideoMessage(videoId, { status: 'failed', error: 'Processing timed out. Tap retry.' });
        return;
      }
      fetch(backend + '/api/ivx/video-pipeline/' + encodeURIComponent(videoId))
        .then(function (res) { return res.json(); })
        .then(function (data) {
          var video = data && data.video;
          if (!video) return;
          if (video.status === 'ready') {
            clearInterval(state.videoPolls[videoId]);
            delete state.videoPolls[videoId];
            updateVideoMessage(videoId, {
              status: 'ready',
              hlsUrl: video.hls_master_url,
              posterUrl: video.poster_url,
              thumbnailUrl: video.thumbnail_url,
              originalUrl: video.original_url,
              duration: video.duration
            });
            setStatus('Video ready to play', 'Your video was optimized for adaptive streaming.', 'connected');
          } else if (video.status === 'failed') {
            clearInterval(state.videoPolls[videoId]);
            delete state.videoPolls[videoId];
            updateVideoMessage(videoId, { status: 'failed', error: video.error || 'Transcoding failed.' });
            setStatus('Video processing failed', 'You can retry processing from the message.', 'warning');
          } else {
            updateVideoMessage(videoId, { status: 'processing' });
          }
        })
        .catch(function () { /* transient poll error — keep polling */ });
    }, VIDEO_POLL_INTERVAL_MS);
  }

  function uploadChatVideo(file) {
    var backend = getBackendUrl();
    if (!backend) {
      appendMessage('support', 'Video upload is unavailable right now (backend not configured). Please try again later.');
      return;
    }

    var message = buildMessage('user', '');
    message.video = {
      videoId: '',
      status: 'uploading',
      progress: 0,
      fileName: file.name,
      posterUrl: null,
      hlsUrl: null,
      originalUrl: null,
      error: null,
      duration: null
    };
    state.messages.push(message);
    renderMessages();
    setStatus('Uploading video', 'Your video is being uploaded securely.', 'waiting');

    var form = new FormData();
    form.append('file', file, file.name);
    form.append('title', 'IVX chat video: ' + file.name);
    form.append('userId', 'landing-chat');

    var xhr = new XMLHttpRequest();
    xhr.open('POST', backend + '/api/ivx/video-pipeline/upload');
    xhr.upload.onprogress = function (event) {
      if (event.lengthComputable) {
        message.video.progress = (event.loaded / event.total) * 100;
        renderMessages();
      }
    };
    xhr.onload = function () {
      var data = null;
      try { data = JSON.parse(xhr.responseText); } catch (error) { data = null; }
      if (xhr.status >= 200 && xhr.status < 300 && data && data.ok && data.videoId) {
        message.video.videoId = data.videoId;
        message.video.status = 'processing';
        message.video.originalUrl = data.originalUrl || null;
        renderMessages();
        setStatus('Processing video', 'Transcoding to adaptive quality (1080p\u2013360p).', 'waiting');
        pollVideoStatus(data.videoId);
      } else {
        message.video.status = 'failed';
        message.video.error = (data && data.error) || ('Upload failed (HTTP ' + xhr.status + ')');
        renderMessages();
        setStatus('Video upload failed', 'Check the file format/size and try again.', 'warning');
      }
    };
    xhr.onerror = function () {
      message.video.status = 'failed';
      message.video.error = 'Network error during upload.';
      renderMessages();
      setStatus('Video upload failed', 'Network error \u2014 please retry.', 'warning');
    };
    xhr.send(form);
  }

  function retryChatVideo(videoId) {
    var backend = getBackendUrl();
    if (!backend || !videoId) return;
    updateVideoMessage(videoId, { status: 'processing', error: null });
    setStatus('Retrying video processing', 'Re-running the transcode pipeline.', 'waiting');
    fetch(backend + '/api/ivx/video-pipeline/' + encodeURIComponent(videoId) + '/retry', { method: 'POST' })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data && data.ok) {
          pollVideoStatus(videoId);
        } else {
          updateVideoMessage(videoId, { status: 'failed', error: (data && data.error) || 'Retry rejected.' });
        }
      })
      .catch(function () {
        updateVideoMessage(videoId, { status: 'failed', error: 'Retry request failed.' });
      });
  }

  /* Fullscreen modal player — adaptive HLS via native support or hls.js
     (loaded lazily by the landing page); progressive original as last resort. */
  function openVideoModal(videoId) {
    var message = findVideoMessage(videoId);
    if (!message || message.video.status !== 'ready') return;
    var video = message.video;

    var overlay = document.createElement('div');
    overlay.className = 'landing-chat-video-modal';
    overlay.innerHTML = '<div class="landing-chat-video-modal-inner">' +
      '<button type="button" class="landing-chat-video-modal-close" aria-label="Close">\u00D7</button>' +
      '<video controls autoplay playsinline preload="auto"' + (video.posterUrl ? ' poster="' + escapeHtml(video.posterUrl) + '"' : '') + '></video>' +
      '</div>';
    document.body.appendChild(overlay);

    var player = overlay.querySelector('video');
    var hlsUrl = video.hlsUrl;
    if (hlsUrl) {
      player.setAttribute('data-hls', hlsUrl);
      if (video.originalUrl) player.setAttribute('data-fallback', video.originalUrl);
      if (typeof window.ivxAttachHls === 'function') {
        window.ivxAttachHls(player);
      } else if (player.canPlayType('application/vnd.apple.mpegurl')) {
        player.src = hlsUrl;
      } else if (video.originalUrl) {
        player.src = video.originalUrl;
      }
    } else if (video.originalUrl) {
      player.src = video.originalUrl;
    }

    function close() {
      try {
        player.pause();
        if (player.__ivxHls && typeof player.__ivxHls.destroy === 'function') player.__ivxHls.destroy();
      } catch (error) { /* noop */ }
      overlay.remove();
    }
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) close();
    });
    overlay.querySelector('.landing-chat-video-modal-close').addEventListener('click', close);
  }

  function appendMessage(role, text) {
    state.messages.push(buildMessage(role, text));
    renderMessages();
  }

  function buildConversationSummary() {
    return state.messages
      .slice(-8)
      .map(function (message) {
        return (message.role === 'user' ? 'User' : 'Assistant') + ': ' + message.text;
      })
      .join('\n');
  }

  function buildPrompt(userText, conversationSummary) {
    return [
      'You are the IVX Holdings LLC investor and platform support assistant for the public landing page.',
      'Facts:',
      '- Legal entity: IVX Holdings LLC',
      '- Investor relations: investors@ivxholding.com',
      '- Investor relations: investors@ivxholding.com',
      '- Business address: 1001 Brickell Bay Drive, Suite 2700, Miami, FL 33131',
      '- Public visitors can request investor access through the intake on this page.',
      '- Approved members move into registration, profile activation, wallet readiness, and transaction visibility.',
      '- Qualified prospects can request management diligence calls during active review.',
      '- The platform can answer investor questions, account-support questions, and high-level technical questions about the IVX mobile and web frontend, backend services, Supabase flows, AWS S3/CloudFront, and ChatGPT or OpenAI-style AI chat integrations.',
      '- Never guarantee returns, liquidity, uptime, or automatic code fixes.',
      '- If execution or incident review is required, direct the visitor to live support.',
      'For technical questions, explain what the stack supports now, what to check next, and when a human should take over.',
      'Keep answers concise, factual, and investor-ready.',
      conversationSummary ? 'Recent conversation:\n' + conversationSummary : '',
      'User question: ' + userText
    ].filter(Boolean).join('\n');
  }

  function buildFallback(userText) {
    var lowerText = String(userText || '').toLowerCase();

    if ((lowerText.indexOf('how') !== -1 && lowerText.indexOf('invest') !== -1) || lowerText.indexOf('start') !== -1) {
      return 'Start with the investor intake on this page, complete the verified contact and identity fields, and IVX will review eligibility before live allocation access is opened. Minimums and deal terms can vary by opportunity, and returns are never guaranteed.';
    }

    if (lowerText.indexOf('minimum') !== -1 || lowerText.indexOf('$50') !== -1 || lowerText.indexOf('allocation') !== -1) {
      return 'IVX supports access from $50 on supported offerings, but each live opportunity can have its own allocation rules, timing, and investor suitability steps. Review the deal terms carefully before committing.';
    }

    if (lowerText.indexOf('wallet') !== -1 || lowerText.indexOf('profile') !== -1 || lowerText.indexOf('member') !== -1) {
      return 'After approval, investors move into member registration, saved profile setup, wallet preparation, and transaction visibility inside the platform. The public intake is the first step before those member tools are opened.';
    }

    if (lowerText.indexOf('management') !== -1 || lowerText.indexOf('team') !== -1 || lowerText.indexOf('call') !== -1) {
      return 'Qualified prospects can request a management diligence call during active review. Use the live support button below or contact investors@ivxholding.com and the IVX team will coordinate next steps.';
    }

    if (lowerText.indexOf('chatgpt') !== -1 || lowerText.indexOf('openai') !== -1 || lowerText.indexOf('gpt') !== -1) {
      return 'For ChatGPT or OpenAI-style integration, the safest pattern is a controlled backend or approved gateway layer, clear prompt rules, rate limits, fallbacks, and human-governed releases. I can explain the setup, but I should not claim autonomous deployment or self-healing code.';
    }

    if (lowerText.indexOf('aws') !== -1 || lowerText.indexOf('amazon') !== -1 || lowerText.indexOf('s3') !== -1 || lowerText.indexOf('cloudfront') !== -1 || lowerText.indexOf('bucket') !== -1) {
      return 'IVX uses AWS services such as S3 and CloudFront for storage and delivery. The main checks are bucket permissions, object paths, cache invalidation, and origin configuration. I can help triage the likely issue, but production changes still need human review.';
    }

    if (lowerText.indexOf('backend') !== -1 || lowerText.indexOf('supabase') !== -1 || lowerText.indexOf('api') !== -1 || lowerText.indexOf('server') !== -1 || lowerText.indexOf('database') !== -1 || lowerText.indexOf('auth') !== -1) {
      return 'IVX backend workflows rely on Supabase for auth, data, and support flows. The first checks are auth state, access rules, function execution, request payloads, and database writes. I can help narrow the likely failure point and the next safe step.';
    }

    if (lowerText.indexOf('frontend') !== -1 || lowerText.indexOf('app issue') !== -1 || lowerText.indexOf('screen') !== -1 || lowerText.indexOf('expo') !== -1 || lowerText.indexOf('react native') !== -1 || lowerText.indexOf('landing page') !== -1 || lowerText.indexOf('keyboard') !== -1) {
      return 'IVX uses shared Expo and React Native frontend flows across the app and landing page. The usual checks are route state, screen-level errors, keyboard and safe-area layout, web compatibility, and API response handling. I can help narrow the issue and suggest the next implementation step.';
    }

    if (lowerText.indexOf('technical') !== -1 || lowerText.indexOf('code') !== -1 || lowerText.indexOf('bug') !== -1 || lowerText.indexOf('crash') !== -1 || lowerText.indexOf('incident') !== -1) {
      return 'IVX uses a shared app and landing support flow, backend support workflows, AWS-backed delivery layers, and an AI support layer. I can explain the setup and help triage a technical question, but production fixes and releases still need human review.';
    }

    if (lowerText.indexOf('fix automatically') !== -1 || lowerText.indexOf('fix itself') !== -1 || lowerText.indexOf('autonomous') !== -1 || lowerText.indexOf('no human') !== -1 || lowerText.indexOf('full control') !== -1) {
      return 'AI can help answer questions, draft code, explain architecture, and support technical triage. It should not be presented as having full autonomous control over production fixes, releases, or infrastructure without human review.';
    }

    if (lowerText.indexOf('ai') !== -1 || lowerText.indexOf('assistant') !== -1) {
      return 'The AI chat can answer investor, product, and technical-support questions, including frontend, backend, AWS, and integration topics. It can guide and triage, but it should not claim that production code was changed automatically without human approval.';
    }

    if (lowerText.indexOf('risk') !== -1 || lowerText.indexOf('safe') !== -1 || lowerText.indexOf('guarantee') !== -1 || lowerText.indexOf('return') !== -1) {
      return 'All investments involve risk, including partial or total loss of capital. Projected ROI, fees, liquidity, and exit timing vary by deal, and returns are not guaranteed.';
    }

    if (lowerText.indexOf('dividend') !== -1 || lowerText.indexOf('distribution') !== -1) {
      return 'Distribution timing depends on the specific offering and its documents. Review each opportunity’s terms because distributions, expenses, and timelines can change based on project performance.';
    }

    return 'I can help with investor intake, live opportunities, member readiness, platform support, technical triage, AWS and backend questions, and public risk disclosures. If you need direct follow-up from the IVX team, use the live support request below.';
  }

  async function requestAiResponse(userText) {
    // 1) Live backend AI chat (/api/public/chat) — the production AI gateway.
    try {
      var backend = getBackendUrl();
      if (backend) {
        var chatRes = await fetch(backend.replace(/\/+$/, '') + '/api/public/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: userText })
        });
        if (chatRes.ok) {
          var chatData = await chatRes.json();
          if (chatData && chatData.answer) {
            console.log('[IVX Landing Chat] AI response from live gateway');
            return chatData.answer;
          }
        }
      }
    } catch (error) {
      console.warn('[IVX Landing Chat] Live gateway request failed:', error && error.message ? error.message : error);
    }

    // 2) Supabase edge function fallback.
    var client = getClient();

    if (client && client.functions && typeof client.functions.invoke === 'function') {
      try {
        var result = await client.functions.invoke('ai-generate', {
          body: {
            prompt: buildPrompt(userText, buildConversationSummary()),
            type: 'text'
          }
        });
        var responseText = result && result.data ? (result.data.text || result.data.result || '') : '';

        if (responseText) {
          console.log('[IVX Landing Chat] AI response loaded from edge function');
          return responseText;
        }

        if (result && result.error) {
          console.warn('[IVX Landing Chat] Edge function returned error:', result.error.message || result.error);
        }
      } catch (error) {
        console.warn('[IVX Landing Chat] Edge function request failed:', error && error.message ? error.message : error);
      }
    }

    return buildFallback(userText);
  }

  async function handleSend() {
    if (state.busy) {
      return;
    }

    var elements = getElements();
    if (!elements.input) {
      return;
    }

    var userText = elements.input.value.trim();
    if (!userText) {
      return;
    }

    appendMessage('user', userText);
    elements.input.value = '';
    state.busy = true;
    updateBusyState();
    setStatus('IVX AI is responding', 'Reviewing allocations, technical support, and member access now.', 'waiting');

    try {
      var reply = await requestAiResponse(userText);
      appendMessage('support', reply);
      setStatus('IVX AI ready', 'Ask about allocations, support, AWS, ChatGPT, or risk disclosures.', 'connected');

      if (typeof window.fireAdEvent === 'function') {
        window.fireAdEvent('contact', {
          content_name: 'Landing Investor Chat Message',
          value: 0,
          category: 'engagement'
        });
      }
    } catch (error) {
      console.warn('[IVX Landing Chat] Send flow failed:', error && error.message ? error.message : error);
      appendMessage('support', buildFallback(userText));
      setStatus('Investor chat fallback active', 'Live support is still available below.', 'warning');
    } finally {
      state.busy = false;
      updateBusyState();
    }
  }

  function classifySupportCategory(transcript) {
    var lowerText = String(transcript || '').toLowerCase();

    if (lowerText.indexOf('technical') !== -1 || lowerText.indexOf('frontend') !== -1 || lowerText.indexOf('backend') !== -1 || lowerText.indexOf('supabase') !== -1 || lowerText.indexOf('aws') !== -1 || lowerText.indexOf('amazon') !== -1 || lowerText.indexOf('s3') !== -1 || lowerText.indexOf('cloudfront') !== -1 || lowerText.indexOf('chatgpt') !== -1 || lowerText.indexOf('openai') !== -1 || lowerText.indexOf('bug') !== -1 || lowerText.indexOf('crash') !== -1 || lowerText.indexOf('error') !== -1) {
      return 'technical';
    }

    return 'general';
  }

  function classifySupportPriority(transcript) {
    var lowerText = String(transcript || '').toLowerCase();

    if (lowerText.indexOf('security') !== -1 || lowerText.indexOf('funds') !== -1 || lowerText.indexOf('outage') !== -1 || lowerText.indexOf('production down') !== -1 || lowerText.indexOf('urgent') !== -1 || lowerText.indexOf('crash') !== -1) {
      return 'high';
    }

    return classifySupportCategory(transcript) === 'technical' ? 'medium' : 'low';
  }

  async function handleRequestHuman() {
    if (state.busy) {
      return;
    }

    state.busy = true;
    updateBusyState();
    setStatus('Submitting live support request', 'Preparing an investor relations follow-up.', 'waiting');

    var transcript = state.messages
      .filter(function (message) { return message.role === 'user'; })
      .slice(-5)
      .map(function (message) { return message.text; })
      .join(' | ')
      .trim();

    var category = classifySupportCategory(transcript);
    var priority = classifySupportPriority(transcript);
    var subjectPrefix = category === 'technical' ? 'Landing Technical Chat' : 'Landing Investor Chat';
    var subject = transcript.length > 10
      ? subjectPrefix + ': ' + transcript.slice(0, 80) + (transcript.length > 80 ? '…' : '')
      : subjectPrefix + ' Request';
    var message = transcript.length > 10
      ? 'Visitor requested ' + category + ' live support after discussing: ' + transcript.slice(0, 240)
      : 'Visitor requested live investor support from the public landing page.';
    var client = getClient();

    try {
      if (!client) {
        throw new Error('Supabase client unavailable');
      }

      var insertResult = await client
        .from('support_tickets')
        .insert({
          subject: subject,
          category: category,
          message: message,
          status: 'open',
          priority: priority,
          user_id: null
        })
        .select()
        .single();

      if (insertResult.error) {
        throw insertResult.error;
      }

      var ticketId = insertResult.data && insertResult.data.id ? String(insertResult.data.id) : 'pending';
      appendMessage('support', 'Your live investor support request is in. Ticket #' + ticketId.slice(-6) + '. The IVX team will follow up through investor relations. You can also email investors@ivxholding.com if you want immediate contact.');
      setStatus('Live support requested', 'Investor relations will follow up from the public queue.', 'connected');

      if (typeof window.fireAdEvent === 'function') {
        window.fireAdEvent('lead', {
          content_name: 'Landing Live Support Request',
          value: 0,
          category: 'support'
        });
      }
    } catch (error) {
      console.warn('[IVX Landing Chat] Live support request failed:', error && error.message ? error.message : error);
      appendMessage('support', 'We could not create the live support ticket automatically right now. Please email investors@ivxholding.com and mention that you requested investor chat support on the landing page.');
      setStatus('Direct investor contact recommended', 'Email IVX investor relations now.', 'warning');
    } finally {
      state.busy = false;
      updateBusyState();
    }
  }

  function handleQuickReply(event) {
    var reply = event.currentTarget.getAttribute('data-reply') || '';
    var elements = getElements();
    if (!elements.input) {
      return;
    }

    elements.input.value = reply;
    elements.input.focus();
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  }

  function init() {
    if (state.initialized) {
      return;
    }

    var elements = getElements();
    if (!elements.shell || !elements.messages || !elements.input || !elements.send || !elements.human) {
      return;
    }

    state.initialized = true;
    state.messages = [
      buildMessage('support', 'Hello! Welcome to IVX investor support. Ask about live opportunities, member readiness, frontend or backend support, AWS operations, ChatGPT integration, management diligence, or the intake on this page.')
    ];

    renderMessages();
    updateBusyState();
    setStatus('IVX AI ready', 'Ask about allocations, support, AWS, ChatGPT, or risk disclosures.', 'connected');

    elements.send.addEventListener('click', function () {
      void handleSend();
    });
    elements.human.addEventListener('click', function () {
      void handleRequestHuman();
    });
    elements.input.addEventListener('keydown', handleKeyDown);

    var attachButton = document.getElementById('landing-chat-attach');
    var videoInput = document.getElementById('landing-chat-video-input');
    if (attachButton && videoInput) {
      attachButton.addEventListener('click', function () {
        videoInput.click();
      });
      videoInput.addEventListener('change', function () {
        var file = videoInput.files && videoInput.files[0];
        videoInput.value = '';
        if (file) uploadChatVideo(file);
      });
    }

    elements.messages.addEventListener('click', function (event) {
      var openTarget = event.target.closest ? event.target.closest('[data-video-open]') : null;
      if (openTarget) {
        openVideoModal(openTarget.getAttribute('data-video-open'));
        return;
      }
      var retryTarget = event.target.closest ? event.target.closest('[data-video-retry]') : null;
      if (retryTarget) {
        retryChatVideo(retryTarget.getAttribute('data-video-retry'));
      }
    });

    Array.prototype.forEach.call(elements.quickReplyButtons, function (button, index) {
      if (!button.textContent) {
        button.textContent = QUICK_REPLIES[index] || 'Ask IVX';
      }
      button.addEventListener('click', handleQuickReply);
    });

    console.log('[IVX Landing Chat] Initialized');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
