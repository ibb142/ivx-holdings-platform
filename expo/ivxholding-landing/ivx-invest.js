/**
 * IVX Investment Funnel — lazy-loaded module for the public landing page.
 * Loaded on demand when the user clicks "Invest" on a deal card.
 */
(function(window) {
  'use strict';

  // ---- Phase 2 reliability: explicit registration state machine ----
  var REG_STATES = {
    IDLE: 'IDLE', VALIDATING: 'VALIDATING', SUBMITTING: 'SUBMITTING',
    AUTH_CREATING: 'AUTH_CREATING', PROFILE_CREATING: 'PROFILE_CREATING',
    INTEREST_CREATING: 'INTEREST_CREATING', SESSION_CREATING: 'SESSION_CREATING',
    EMAIL_CONFIRMATION_REQUIRED: 'EMAIL_CONFIRMATION_REQUIRED',
    COMPLETED: 'COMPLETED', RECOVERABLE_ERROR: 'RECOVERABLE_ERROR',
    BLOCKED: 'BLOCKED', RATE_LIMITED: 'RATE_LIMITED'
  };
  var _regState = REG_STATES.IDLE;
  function setRegState(s) { _regState = s; console.log('[IVX Reg] state ->', s); }
  function regStateIsTerminal() { return _regState === REG_STATES.COMPLETED || _regState === REG_STATES.BLOCKED; }

  // ---- Request ID + trace ID (idempotency) ----
  function uuidv4() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
  function genTraceId() { return 'ivx-reg-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8); }

  // ---- Form preservation (no password, no token — only non-sensitive context) ----
  var PENDING_KEY = 'ivx_pending_registration';
  function savePendingForm(ctx) {
    try {
      var safe = {
        firstName: ctx.firstName || '',
        lastName: ctx.lastName || '',
        email: ctx.email || '',
        dealId: ctx.dealId || '',
        amount: ctx.amount || 0,
        step: ctx.step || 1,
        registrationRequestId: ctx.registrationRequestId || '',
        authMode: ctx.authMode || 'signup',
        savedAt: Date.now()
      };
      window.localStorage.setItem(PENDING_KEY, JSON.stringify(safe));
    } catch (e) { /* localStorage may be unavailable in private mode */ }
  }
  function loadPendingForm() {
    try {
      var raw = window.localStorage.getItem(PENDING_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      // Expire after 30 minutes — don't resume a stale context.
      if (Date.now() - (parsed.savedAt || 0) > 30 * 60 * 1000) { window.localStorage.removeItem(PENDING_KEY); return null; }
      return parsed;
    } catch (e) { return null; }
  }
  function clearPendingForm() { try { window.localStorage.removeItem(PENDING_KEY); } catch (e) {} }

  // ---- Config validation (Phase 2 §1) ----
  function getBackendUrl() {
    return (window.IVX_API || window.__IVX_BACKEND_URL || 'https://api.ivxholding.com').replace(/\/+$/, '');
  }
  function getSupabaseConfig() {
    var url = window.IVX_SUPABASE_URL || window.SUPABASE_URL || '';
    var key = window.IVX_SUPABASE_ANON_KEY || window.SUPABASE_ANON_KEY || '';
    return { url: url, key: key };
  }
  function validateAuthConfiguration() {
    var cfg = getSupabaseConfig();
    var traceId = genTraceId();
    var problems = [];
    if (!cfg.url) problems.push('URL missing');
    else if (String(cfg.url).indexOf('__IVX_') === 0) problems.push('URL is placeholder');
    else if (cfg.url.indexOf('.supabase.co') === -1) problems.push('URL not a Supabase project');
    if (!cfg.key) problems.push('anon key missing');
    else if (String(cfg.key).indexOf('__IVX_') === 0) problems.push('anon key is placeholder');
    if (!window.supabase) problems.push('Supabase library not loaded');
    var ok = problems.length === 0;
    return { ok: ok, problems: problems, traceId: traceId, config: cfg };
  }
  // Exposed for index.html startup check
  window.IVXValidateAuthConfiguration = validateAuthConfiguration;

  var _investState = {
    dealId: '', dealTitle: '', dealProjectName: '', dealAddress: '', dealTotal: 0, dealROI: 0, dealFrequency: 'Monthly',
    pool: 'jv_direct', amount: 0, paymentMethod: 'bank', termsAgreed: false, step: 1,
    userEmail: '', userToken: '', userId: '', _authSb: null, authMode: 'signup',
    registrationRequestId: '', traceId: ''
  };

  function isPlaceholder(v) { return !v || String(v).indexOf('__IVX_') === 0; }
  function getLiveDealData(id) { if (window.getLiveDealData) return window.getLiveDealData(id); return null; }
  function formatInvestCurrency(num) {
    if (!num || isNaN(num)) return '$0'; num = Number(num);
    if (num >= 1e6) return '$' + (num / 1e6).toFixed(1) + 'M';
    if (num >= 1e3) return '$' + (num / 1e3).toFixed(0) + 'K';
    return '$' + num.toLocaleString();
  }
  function fireAdEvent(name, params) { if (window.fireAdEvent) window.fireAdEvent(name, params); }
  function createInvestorProfile() { /* forwarded to main bundle if present */ }

  function openInvestModal(dealId) {
    var deal = getLiveDealData(dealId) || { title: dealId, projectName: '', address: '', totalInvestment: 0, expectedROI: 0, distributionFrequency: 'Monthly' };
    _investState.dealId = dealId;
    _investState.dealTitle = deal.title;
    _investState.dealProjectName = deal.projectName;
    _investState.dealAddress = deal.address;
    _investState.dealTotal = deal.totalInvestment;
    _investState.dealROI = deal.expectedROI;
    _investState.dealFrequency = deal.distributionFrequency;
    _investState.pool = 'jv_direct'; _investState.amount = 0; _investState.paymentMethod = 'bank'; _investState.termsAgreed = false; _investState.step = 1;
    var el = function(id) { return document.getElementById(id); };
    if (el('invest-deal-title')) el('invest-deal-title').textContent = deal.title;
    if (el('invest-deal-desc')) el('invest-deal-desc').textContent = deal.projectName + ' — Choose your investment type below.';
    if (el('invest-deal-name-display')) el('invest-deal-name-display').textContent = deal.title;
    if (el('invest-deal-loc-display')) el('invest-deal-loc-display').textContent = deal.address || 'Location TBD';
    if (el('invest-total-display')) el('invest-total-display').textContent = formatInvestCurrency(deal.totalInvestment);
    if (el('invest-roi-display')) el('invest-roi-display').textContent = deal.expectedROI + '%';
    if (el('invest-freq-display')) el('invest-freq-display').textContent = deal.distributionFrequency;
    if (el('invest-summary-roi-pct')) el('invest-summary-roi-pct').textContent = String(deal.expectedROI);
    selectInvestPool('jv_direct');
    if (el('invest-amount-input')) el('invest-amount-input').value = '';
    updateInvestSummary();
    _investState.termsAgreed = false;
    var termsRow = el('invest-terms-row'); if (termsRow) termsRow.classList.remove('checked');
    var confirmBtn = el('invest-confirm-btn');
    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Agree to terms to confirm'; }
    checkInvestAuth();
    showInvestStep(1);
    document.getElementById('invest-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeInvestModal() {
    document.getElementById('invest-overlay').classList.remove('open');
    document.body.style.overflow = '';
  }

  function showInvestStep(step) {
    _investState.step = step;
    for (var i = 1; i <= 5; i++) {
      var stepEl = document.getElementById('invest-step-' + i);
      if (stepEl) stepEl.style.display = (i === step) ? 'block' : 'none';
    }
    var pct = step <= 4 ? ((step / 4) * 100) : 100;
    var progEl = document.getElementById('invest-progress');
    if (progEl) progEl.style.width = pct + '%';
  }

  function selectInvestPool(pool) {
    _investState.pool = pool;
    var jvEl = document.getElementById('invest-pool-jv');
    var tokenEl = document.getElementById('invest-pool-token');
    if (jvEl) jvEl.className = 'invest-pool-option' + (pool === 'jv_direct' ? ' selected' : '');
    if (tokenEl) tokenEl.className = 'invest-pool-option' + (pool === 'token_shares' ? ' selected' : '');
    var minEl = document.getElementById('invest-min-display');
    var labelEl = document.getElementById('invest-pool-label-display');
    if (pool === 'token_shares') {
      if (minEl) minEl.textContent = 'Deal minimum';
      if (labelEl) labelEl.textContent = 'Fractional Shares';
    } else {
      if (minEl) minEl.textContent = '$1,000';
      if (labelEl) labelEl.textContent = 'JV Direct Investment';
    }
  }

  function setInvestAmount(amount) {
    _investState.amount = amount;
    var input = document.getElementById('invest-amount-input');
    if (input) input.value = amount.toLocaleString();
    document.querySelectorAll('.invest-quick-btn').forEach(function(btn) {
      var txt = btn.textContent.replace(/[^0-9K]/g, '');
      var val = parseInt(txt, 10);
      if (btn.textContent.indexOf('K') !== -1) val *= 1000;
      btn.className = 'invest-quick-btn' + (val === amount ? ' active' : '');
    });
    updateInvestSummary();
  }

  function updateInvestSummary() {
    var input = document.getElementById('invest-amount-input');
    var raw = input ? input.value.replace(/[^0-9.]/g, '') : '0';
    var amount = parseFloat(raw) || 0;
    _investState.amount = amount;
    var total = _investState.dealTotal || 1400000;
    var roi = _investState.dealROI || 30;
    var equity = total > 0 ? ((amount / total) * 100) : 0;
    var estReturn = amount * (roi / 100);
    var amtEl = document.getElementById('invest-summary-amount');
    var eqEl = document.getElementById('invest-summary-equity');
    var retEl = document.getElementById('invest-summary-return');
    if (amtEl) amtEl.textContent = '$' + amount.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
    if (eqEl) eqEl.textContent = equity.toFixed(4) + '%';
    if (retEl) retEl.textContent = '$' + estReturn.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
    var ctaBtn = document.getElementById('invest-amount-cta');
    var minAmount = _investState.pool === 'token_shares' ? 50 : 1000;
    if (ctaBtn) {
      if (amount >= minAmount) { ctaBtn.disabled = false; ctaBtn.textContent = 'Continue \u2192'; }
      else { ctaBtn.disabled = true; ctaBtn.textContent = amount > 0 ? 'Minimum $' + minAmount.toLocaleString() : 'Enter amount to continue'; }
    }
  }

  function goInvestStep(step) {
    showInvestStep(step);
    if (step === 4) {
      var el = function(id) { return document.getElementById(id); };
      if (el('review-deal')) el('review-deal').textContent = _investState.dealTitle;
      if (el('review-type')) el('review-type').textContent = _investState.pool === 'token_shares' ? 'Fractional Shares' : 'JV Direct Investment';
      if (el('review-amount')) el('review-amount').textContent = '$' + _investState.amount.toLocaleString();
      var eq = _investState.dealTotal > 0 ? ((_investState.amount / _investState.dealTotal) * 100).toFixed(4) + '%' : '0%';
      if (el('review-equity')) el('review-equity').textContent = eq;
      if (el('review-roi')) el('review-roi').textContent = '+' + _investState.dealROI + '% ($' + (_investState.amount * _investState.dealROI / 100).toLocaleString() + ')';
      var payLabels = { bank: 'Bank Transfer (ACH)', wire: 'Wire Transfer', wallet: 'Wallet Balance' };
      if (el('review-payment')) el('review-payment').textContent = payLabels[_investState.paymentMethod] || 'Bank Transfer';
    }
  }

  function switchInvestAuthTab(tab) {
    _investState.authMode = tab;
    var su = document.getElementById('invest-tab-signup');
    var li = document.getElementById('invest-tab-login');
    var nr = document.getElementById('invest-name-row');
    var ab = document.getElementById('invest-auth-btn');
    if (tab === 'signup') {
      if (su) su.className = 'invest-auth-tab active';
      if (li) li.className = 'invest-auth-tab';
      if (nr) nr.style.display = 'grid';
      if (ab) ab.innerHTML = 'Create Account &amp; Continue &#8594;';
    } else {
      if (su) su.className = 'invest-auth-tab';
      if (li) li.className = 'invest-auth-tab active';
      if (nr) nr.style.display = 'none';
      if (ab) ab.innerHTML = 'Log In &amp; Continue &#8594;';
    }
  }

  function checkInvestAuth() {
    var authBox = document.getElementById('invest-auth-box');
    var authView = document.getElementById('invest-authenticated-view');
    if (_investState.userToken && _investState.userEmail) {
      if (authBox) authBox.style.display = 'none';
      if (authView) authView.style.display = 'block';
      var em = document.getElementById('invest-user-email');
      if (em) em.textContent = _investState.userEmail;
    } else {
      if (authBox) authBox.style.display = 'block';
      if (authView) authView.style.display = 'none';
    }
  }

  async function handleInvestAuth(e) {
    e.preventDefault();
    // Phase 2: double-submit prevention via state machine.
    if (_regState === REG_STATES.SUBMITTING || _regState === REG_STATES.AUTH_CREATING || _regState === REG_STATES.PROFILE_CREATING) {
      console.warn('[IVX Reg] Already submitting — ignoring duplicate tap. state:', _regState);
      return;
    }
    setRegState(REG_STATES.VALIDATING);

    var errEl = document.getElementById('invest-auth-error');
    var btn = document.getElementById('invest-auth-btn');
    if (errEl) errEl.style.display = 'none';
    var email = document.getElementById('invest-email').value.trim();
    var password = document.getElementById('invest-password').value;
    var fn = _investState.authMode === 'signup' ? (document.getElementById('invest-first').value.trim() || '') : '';
    var ln = _investState.authMode === 'signup' ? (document.getElementById('invest-last').value.trim() || '') : '';
    var dob = _investState.authMode === 'signup' ? (document.getElementById('invest-birthday') ? document.getElementById('invest-birthday').value : '') : '';
    var gender = _investState.authMode === 'signup' ? (document.getElementById('invest-gender') ? document.getElementById('invest-gender').value : '') : '';
    var phoneInput = _investState.authMode === 'signup' ? (document.getElementById('invest-phone') ? document.getElementById('invest-phone').value.trim() : '555-000-0000') : '';

    // Inline field validation — never calls backend.
    if (!email || email.indexOf('@') === -1) {
      if (errEl) { errEl.textContent = 'Enter a valid email'; errEl.style.display = 'block'; }
      setRegState(REG_STATES.IDLE); return;
    }
    if (_investState.authMode === 'signup') {
      if (!fn) { if (errEl) { errEl.textContent = 'Enter your first name'; errEl.style.display = 'block'; } setRegState(REG_STATES.IDLE); return; }
      if (!ln) { if (errEl) { errEl.textContent = 'Enter your last name'; errEl.style.display = 'block'; } setRegState(REG_STATES.IDLE); return; }
      if (!dob) { if (errEl) { errEl.textContent = 'Enter your date of birth'; errEl.style.display = 'block'; } setRegState(REG_STATES.IDLE); return; }
      if (!gender) { if (errEl) { errEl.textContent = 'Select your gender'; errEl.style.display = 'block'; } setRegState(REG_STATES.IDLE); return; }
      if (!password || password.length < 12) {
        if (errEl) { errEl.textContent = 'Password must be at least 12 characters'; errEl.style.display = 'block'; }
        setRegState(REG_STATES.IDLE); return;
      }
    } else {
      if (!password || password.length < 6) {
        if (errEl) { errEl.textContent = 'Password must be at least 6 characters'; errEl.style.display = 'block'; }
        setRegState(REG_STATES.IDLE); return;
      }
    }

    // Phase 2 §4: preserve non-sensitive pending form (no password, no token).
    // Reuse the existing registrationRequestId on resume so the backend can dedupe.
    var pending = loadPendingForm();
    var registrationRequestId = (pending && pending.registrationRequestId) || uuidv4();
    _investState.registrationRequestId = registrationRequestId;
    _investState.traceId = genTraceId();
    savePendingForm({
      firstName: fn, lastName: ln, email: email,
      dealId: _investState.dealId, amount: _investState.amount, step: _investState.step,
      registrationRequestId: registrationRequestId, authMode: _investState.authMode
    });

    setRegState(REG_STATES.SUBMITTING);
    if (btn) { btn.textContent = 'Creating secure account…'; btn.disabled = true; }

    function setAuthError(text) { if (errEl) { errEl.textContent = text; errEl.style.display = 'block'; } }
    function resetBtn() { if (btn) { btn.textContent = _investState.authMode === 'signup' ? 'Create Account & Continue \u2192' : 'Log In & Continue \u2192'; btn.disabled = false; } }
    function failWithState(text, state) {
      setAuthError(text);
      resetBtn();
      setRegState(state || REG_STATES.RECOVERABLE_ERROR);
    }

    // Phase 2 §1: validate auth configuration before any network call.
    var cfgCheck = validateAuthConfiguration();
    if (!cfgCheck.ok) {
      console.error('[IVX Reg] Auth config invalid:', cfgCheck.problems.join(', '), 'trace:', cfgCheck.traceId);
      failWithState('Registration is temporarily unavailable. Reference: ' + cfgCheck.traceId, REG_STATES.BLOCKED);
      return;
    }
    var SUPABASE_URL = cfgCheck.config.url;
    var SUPABASE_ANON_KEY = cfgCheck.config.key;
    var BACKEND_URL = getBackendUrl();

    // ---- SIGNUP path: route through the backend orchestrator for idempotency ----
    if (_investState.authMode === 'signup') {
      setRegState(REG_STATES.AUTH_CREATING);
      try {
        var payload = {
          email: email.toLowerCase(),
          password: password,  // sent over HTTPS, never logged, never persisted locally
          firstName: fn, lastName: ln,
          dateOfBirth: dob, gender: gender,
          phone: phoneInput || '555-000-0000', country: 'US', zipCode: '',
          roles: ['investor'],
          acceptTerms: true,
          registrationRequestId: registrationRequestId,
          opportunityId: _investState.dealId,
          opportunityTitle: _investState.dealTitle,
          amount: _investState.amount,
          investmentType: _investState.pool
        };
        // Phase 2 §15: 15s timeout. On timeout, DO NOT auto-resubmit — query status by ID.
        var controller = new AbortController();
        var timeoutId = setTimeout(function() { controller.abort(); }, 15000);
        var resp;
        try {
          resp = await fetch(BACKEND_URL + '/api/members/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
          });
        } catch (fetchErr) {
          if (fetchErr.name === 'AbortError') {
            console.warn('[IVX Reg] Request timed out — polling status by ID. trace:', _investState.traceId);
            setRegState(REG_STATES.RECOVERABLE_ERROR);
            setAuthError('This is taking longer than expected. Checking your registration…');
            var statusResp = await fetch(BACKEND_URL + '/api/ivx/registration/status?id=' + encodeURIComponent(registrationRequestId), { signal: controller.signal }).catch(function() { return null; });
            if (statusResp && statusResp.ok) {
              var statusData = await statusResp.json().catch(function() { return null; });
              if (statusData && statusData.finalStatus === 'completed' && statusData.stage === 'COMPLETED') {
                // The first request actually finished — resume.
                setRegState(REG_STATES.EMAIL_CONFIRMATION_REQUIRED);
                if (btn) { btn.textContent = 'Check your email →'; btn.disabled = false; }
                if (errEl) { errEl.textContent = 'Your account was created. Check your email to confirm, then continue.'; errEl.style.display = 'block'; }
                clearPendingForm();
                return;
              }
            }
            failWithState('We could not complete your registration. Please try again. Reference: ' + _investState.traceId, REG_STATES.RECOVERABLE_ERROR);
            return;
          }
          throw fetchErr;
        } finally {
          clearTimeout(timeoutId);
        }

        var data = await resp.json().catch(function() { return { ok: false, code: 'UNKNOWN_ERROR', message: 'Malformed response from server.' }; });
        if (resp.ok && data.ok) {
          setRegState(REG_STATES.PROFILE_CREATING);
          _investState.userEmail = data.email || email.toLowerCase();
          _investState.userId = data.authUserId || '';
          // Auto-login: email is auto-confirmed server-side, so sign in immediately.
          try {
            _investState._authSb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            var autoLoginResult = await _investState._authSb.auth.signInWithPassword({
              email: email.toLowerCase(),
              password: password
            });
            if (autoLoginResult.error) throw autoLoginResult.error;
            var autoSession = autoLoginResult.data && autoLoginResult.data.session;
            var autoUser = autoLoginResult.data && autoLoginResult.data.user;
            _investState.userToken = (autoSession && autoSession.access_token) || '';
            _investState.userId = (autoUser && autoUser.id) || _investState.userId;
            setRegState(REG_STATES.COMPLETED);
            if (btn) { btn.textContent = '✓ Signed in'; btn.disabled = false; }
            if (errEl) { errEl.textContent = 'Account created! You are now signed in.'; errEl.style.display = 'block'; errEl.style.color = '#22C55E'; }
            checkInvestAuth();
            fireAdEvent('complete_registration', { content_name: 'Invest Auth: signup + auto-login' });
            clearPendingForm();
            return;
          } catch (autoLoginErr) {
            console.warn('[IVX Reg] Auto-login failed, falling back to email confirmation:', autoLoginErr.message);
            setRegState(REG_STATES.EMAIL_CONFIRMATION_REQUIRED);
            if (btn) { btn.textContent = 'Sign in →'; btn.disabled = false; }
            if (errEl) { errEl.textContent = 'Account created. Please sign in to continue.'; errEl.style.display = 'block'; }
            checkInvestAuth();
            clearPendingForm();
            return;
          }
        }

        // Normalized error contract from the orchestrator.
        var code = data.code || 'UNKNOWN_ERROR';
        var msg = data.message || 'Registration failed. Please try again.';
        var traceId = data.traceId || _investState.traceId;
        if (code === 'EMAIL_EXISTS') {
          setRegState(REG_STATES.BLOCKED);
          setAuthError(msg + ' Trace: ' + traceId);
          resetBtn();
          return;
        }
        if (code === 'RATE_LIMITED') {
          setRegState(REG_STATES.RATE_LIMITED);
          setAuthError(msg + ' Trace: ' + traceId);
          resetBtn();
          return;
        }
        if (code === 'WEAK_PASSWORD' || code === 'INVALID_EMAIL') {
          setRegState(REG_STATES.IDLE);
          setAuthError(msg);
          resetBtn();
          return;
        }
        // Network / service / unknown → recoverable.
        failWithState(msg + ' Reference: ' + traceId, REG_STATES.RECOVERABLE_ERROR);
        return;
      } catch (signupErr) {
        console.error('[IVX Reg] Signup orchestration failed:', signupErr.message);
        failWithState('We could not complete your registration. Please try again. Reference: ' + _investState.traceId, REG_STATES.RECOVERABLE_ERROR);
        return;
      }
    }

    // ---- LOGIN path: keep client-side Supabase signIn (no new user created) ----
    setRegState(REG_STATES.AUTH_CREATING);
    try {
      var _authSb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      var authResult = await _authSb.auth.signInWithPassword({ email: email.toLowerCase(), password: password });
      if (authResult.error) throw new Error(authResult.error.message || 'Authentication failed');
      var session = authResult.data && authResult.data.session;
      var user = authResult.data && authResult.data.user;
      _investState.userEmail = (user && user.email) || email;
      _investState.userToken = (session && session.access_token) || '';
      _investState.userId = (user && user.id) || '';
      _investState._authSb = _authSb;
      setRegState(REG_STATES.COMPLETED);
      checkInvestAuth();
      fireAdEvent('complete_registration', { content_name: 'Invest Auth: login' });
      console.log('[IVX Invest] Login successful for:', _investState.userEmail);
      if (btn) { btn.textContent = 'Continue \u2192'; btn.disabled = false; }
      if (window.createInvestorProfile) window.createInvestorProfile(_investState.userId, _investState.userEmail, _investState.userToken, '', '');
      clearPendingForm();
    } catch (loginErr) {
      console.error('[IVX Invest] Login failed:', loginErr.message);
      var m = (loginErr.message || '').toLowerCase();
      var friendly = 'Incorrect email or password. Please try again.';
      if (m.indexOf('rate limit') !== -1 || m.indexOf('429') !== -1) friendly = 'Too many attempts. Please wait a moment and try again.';
      else if (m.indexOf('network') !== -1 || m.indexOf('timeout') !== -1) friendly = 'We could not reach the server. Check your connection and try again.';
      failWithState(friendly, REG_STATES.RECOVERABLE_ERROR);
      return;
    }
  }

  function selectPaymentMethod(method) {
    _investState.paymentMethod = method;
    ['bank','wire','wallet'].forEach(function(m) {
      var el = document.getElementById('invest-pay-' + m);
      if (el) el.className = 'invest-payment-option' + (m === method ? ' selected' : '');
    });
  }

  function toggleInvestTerms() {
    _investState.termsAgreed = !_investState.termsAgreed;
    var termsRow = document.getElementById('invest-terms-row');
    if (termsRow) termsRow.className = 'invest-terms-row' + (_investState.termsAgreed ? ' checked' : '');
    var confirmBtn = document.getElementById('invest-confirm-btn');
    if (confirmBtn) {
      confirmBtn.disabled = !_investState.termsAgreed;
      confirmBtn.textContent = _investState.termsAgreed ? 'Confirm Investment \u2713' : 'Agree to terms to confirm';
    }
  }

  async function submitInvestment() {
    var SUPABASE_URL = window.IVX_SUPABASE_URL || window.SUPABASE_URL || '';
    var SUPABASE_ANON_KEY = window.IVX_SUPABASE_ANON_KEY || window.SUPABASE_ANON_KEY || '';
    if (!_investState.termsAgreed || !_investState.userToken || isPlaceholder(SUPABASE_URL)) {
      var errEl = document.getElementById('invest-step-error');
      if (errEl) { errEl.textContent = 'Authentication or terms not completed.'; errEl.style.display = 'block'; }
      return;
    }
    var confirmBtn = document.getElementById('invest-confirm-btn');
    if (confirmBtn) { confirmBtn.textContent = 'Submitting...'; confirmBtn.disabled = true; }
    try {
      var payload = {
        investor_id: _investState.userId,
        deal_id: _investState.dealId,
        deal_title: _investState.dealTitle,
        amount: _investState.amount,
        investment_type: _investState.pool,
        payment_method: _investState.paymentMethod,
        status: 'pending_payment',
        created_at: new Date().toISOString()
      };
      var resp = await fetch(SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/landing_investments', {
        method: 'POST',
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + _investState.userToken, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) throw new Error('Investment submission failed: ' + resp.status);
      fireAdEvent('purchase', { value: _investState.amount, currency: 'USD' });
      showInvestStep(5);
    } catch(err) {
      console.error('[IVX Invest] Submit error:', err.message);
      var errEl = document.getElementById('invest-step-error');
      if (errEl) { errEl.textContent = err.message; errEl.style.display = 'block'; }
      if (confirmBtn) { confirmBtn.textContent = 'Confirm Investment \u2713'; confirmBtn.disabled = false; }
    }
  }

  window.IVXInvest = {
    open: openInvestModal,
    close: closeInvestModal,
    showStep: showInvestStep,
    selectPool: selectInvestPool,
    setAmount: setInvestAmount,
    updateSummary: updateInvestSummary,
    goStep: goInvestStep,
    switchAuthTab: switchInvestAuthTab,
    handleAuth: handleInvestAuth,
    selectPayment: selectPaymentMethod,
    toggleTerms: toggleInvestTerms,
    submit: submitInvestment
  };
})(window);
