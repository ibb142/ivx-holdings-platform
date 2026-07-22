/**
 * IVX Investment Funnel — lazy-loaded module for the public landing page.
 * Loaded on demand when the user clicks "Invest" on a deal card.
 */
(function(window) {
  'use strict';

  var _investState = {
    dealId: '', dealTitle: '', dealProjectName: '', dealAddress: '', dealTotal: 0, dealROI: 0, dealFrequency: 'Monthly',
    pool: 'jv_direct', amount: 0, paymentMethod: 'bank', termsAgreed: false, step: 1,
    userEmail: '', userToken: '', userId: '', _authSb: null, authMode: 'signup'
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
    var SUPABASE_URL = window.IVX_SUPABASE_URL || window.SUPABASE_URL || '';
    var SUPABASE_ANON_KEY = window.IVX_SUPABASE_ANON_KEY || window.SUPABASE_ANON_KEY || '';
    var errEl = document.getElementById('invest-auth-error');
    var btn = document.getElementById('invest-auth-btn');
    if (errEl) errEl.style.display = 'none';
    var email = document.getElementById('invest-email').value.trim();
    var password = document.getElementById('invest-password').value;
    if (!email || email.indexOf('@') === -1) { if (errEl) { errEl.textContent = 'Enter a valid email'; errEl.style.display = 'block'; } return; }
    if (!password || password.length < 6) { if (errEl) { errEl.textContent = 'Password must be at least 6 characters'; errEl.style.display = 'block'; } return; }
    if (btn) { btn.textContent = 'Processing...'; btn.disabled = true; }

    var _authSb = null;
    try {
      if (!isPlaceholder(SUPABASE_URL) && !isPlaceholder(SUPABASE_ANON_KEY) && window.supabase) {
        _authSb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      }
    } catch(sbErr) { console.warn('[IVX Invest] Supabase client init failed:', sbErr.message); }

    function mapAuthError(msg) {
      var m = (msg || '').toLowerCase();
      if (m.indexOf('already') !== -1 && m.indexOf('registered') !== -1) return 'An account already exists for this email. Log in or reset your password.';
      if (m.indexOf('invalid credentials') !== -1 || m.indexOf('wrong password') !== -1 || m.indexOf('invalid login') !== -1) return 'Incorrect email or password. Please try again.';
      if (m.indexOf('rate limit') !== -1 || m.indexOf('429') !== -1) return 'Too many attempts. Please wait a moment and try again.';
      if (m.indexOf('weak') !== -1 && m.indexOf('password') !== -1) return 'Use a stronger password (8+ chars, uppercase, number).';
      if (m.indexOf('email') !== -1 && (m.indexOf('invalid') !== -1 || m.indexOf('not confirmed') !== -1)) return 'Enter a valid email address.';
      if (m.indexOf('network') !== -1 || m.indexOf('timeout') !== -1 || m.indexOf('fetch') !== -1) return 'We could not reach the server. Check your connection and try again.';
      return msg || 'Authentication failed. Please try again.';
    }
    function setAuthError(text) { if (errEl) { errEl.textContent = text; errEl.style.display = 'block'; } }
    function resetBtn() { if (btn) { btn.textContent = _investState.authMode === 'signup' ? 'Create Account & Continue \u2192' : 'Log In & Continue \u2192'; btn.disabled = false; } }

    if (_authSb) {
      try {
        var authResult;
        if (_investState.authMode === 'signup') {
          var fn = document.getElementById('invest-first').value.trim();
          var ln = document.getElementById('invest-last').value.trim();
          authResult = await _authSb.auth.signUp({ email: email.toLowerCase(), password: password, options: { data: { first_name: fn || 'Investor', last_name: ln || '' } } });
          if (authResult.error) {
            if (authResult.error.message && authResult.error.message.indexOf('already registered') !== -1) {
              console.log('[IVX Invest] Email already registered, trying login...');
              authResult = await _authSb.auth.signInWithPassword({ email: email.toLowerCase(), password: password });
            }
          }
        } else {
          authResult = await _authSb.auth.signInWithPassword({ email: email.toLowerCase(), password: password });
        }
        if (authResult.error) throw new Error(authResult.error.message || 'Authentication failed');
        var session = authResult.data && authResult.data.session;
        var user = authResult.data && authResult.data.user;
        _investState.userEmail = (user && user.email) || email;
        _investState.userToken = (session && session.access_token) || '';
        _investState.userId = (user && user.id) || '';
        _investState._authSb = _authSb;
        checkInvestAuth();
        fireAdEvent('complete_registration', { content_name: 'Invest Auth: ' + _investState.authMode });
        console.log('[IVX Invest] Real Supabase auth successful for:', _investState.userEmail);
        if (btn) { btn.textContent = 'Account created'; btn.disabled = false; }
        if (window.createInvestorProfile) window.createInvestorProfile(_investState.userId, _investState.userEmail, _investState.userToken, _investState.authMode === 'signup' ? (document.getElementById('invest-first').value.trim() || '') : '', _investState.authMode === 'signup' ? (document.getElementById('invest-last').value.trim() || '') : '');
      } catch(authErr) {
        console.error('[IVX Invest] Supabase auth failed:', authErr.message);
        setAuthError(mapAuthError(authErr.message));
        resetBtn();
        return;
      }
    } else {
      var traceId = 'ivx-auth-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8);
      console.error('[IVX Invest] Cannot authenticate — Supabase not available. Trace:', traceId, 'URL:', SUPABASE_URL ? SUPABASE_URL.substring(0, 40) : 'empty', 'Key:', SUPABASE_ANON_KEY ? 'present' : 'empty', 'lib:', !!window.supabase);
      setAuthError('Registration is temporarily unavailable. Reference: ' + traceId);
      resetBtn();
      return;
    }
    if (btn) { btn.textContent = 'Continue \u2192'; btn.disabled = false; }
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
