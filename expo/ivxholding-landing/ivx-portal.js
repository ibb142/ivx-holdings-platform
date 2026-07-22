/**
 * IVX Investor Portal — lazy-loaded module for the public landing page.
 * Loaded on demand when the user clicks "My Portal" or opens the invest funnel.
 * Keeps the public landing bundle free of admin/portal runtime code.
 */
(function(window) {
  'use strict';

  function isPlaceholder(v) { return !v || String(v).indexOf('__IVX_') === 0; }

  var _portalState = { userId: '', email: '', token: '', firstName: '', lastName: '', sb: null };

  function openPortal() {
    document.getElementById('portal-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem('ivx_portal_session') || 'null'); } catch(e) {}
    if (saved && saved.token && saved.email && (Date.now() - saved.ts) < 3600000) {
      _portalState.userId = saved.userId;
      _portalState.email = saved.email;
      _portalState.token = saved.token;
      _portalState.firstName = saved.firstName || '';
      _portalState.lastName = saved.lastName || '';
      showPortalDashboard();
    } else {
      document.getElementById('portal-login-view').style.display = 'block';
      document.getElementById('portal-dashboard').classList.remove('active');
    }
  }

  function closePortal() {
    document.getElementById('portal-overlay').classList.remove('open');
    document.body.style.overflow = '';
  }

  async function handlePortalLogin(e) {
    e.preventDefault();
    var SUPABASE_URL = window.IVX_SUPABASE_URL || window.SUPABASE_URL || '';
    var SUPABASE_ANON_KEY = window.IVX_SUPABASE_ANON_KEY || window.SUPABASE_ANON_KEY || '';
    var errEl = document.getElementById('portal-login-error');
    var btn = document.getElementById('portal-login-btn');
    errEl.style.display = 'none';
    var email = document.getElementById('portal-email').value.trim();
    var password = document.getElementById('portal-password').value;
    if (!email || email.indexOf('@') === -1) { errEl.textContent = 'Enter a valid email'; errEl.style.display = 'block'; return; }
    if (!password || password.length < 6) { errEl.textContent = 'Password must be at least 6 characters'; errEl.style.display = 'block'; return; }
    btn.textContent = 'Signing in...'; btn.disabled = true;
    try {
      if (isPlaceholder(SUPABASE_URL) || isPlaceholder(SUPABASE_ANON_KEY) || !window.supabase) {
        throw new Error('Service temporarily unavailable');
      }
      var portalSb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      var authResult = await portalSb.auth.signInWithPassword({ email: email.toLowerCase(), password: password });
      if (authResult.error) throw new Error(authResult.error.message || 'Login failed');
      var session = authResult.data && authResult.data.session;
      var user = authResult.data && authResult.data.user;
      _portalState.userId = (user && user.id) || '';
      _portalState.email = (user && user.email) || email;
      _portalState.token = (session && session.access_token) || '';
      _portalState.firstName = (user && user.user_metadata && user.user_metadata.first_name) || email.split('@')[0];
      _portalState.lastName = (user && user.user_metadata && user.user_metadata.last_name) || '';
      _portalState.sb = portalSb;
      try { localStorage.setItem('ivx_portal_session', JSON.stringify({ userId: _portalState.userId, email: _portalState.email, token: _portalState.token, firstName: _portalState.firstName, lastName: _portalState.lastName, ts: Date.now() })); } catch(e) {}
      if (window.createInvestorProfile) window.createInvestorProfile(_portalState.userId, _portalState.email, _portalState.token, _portalState.firstName, _portalState.lastName);
      showPortalDashboard();
    } catch(err) {
      console.error('[IVX Portal] Login error:', err.message);
      errEl.textContent = err.message || 'Login failed. Please try again.';
      errEl.style.display = 'block';
    }
    btn.textContent = 'Sign In \u2192'; btn.disabled = false;
  }

  async function showPortalDashboard() {
    document.getElementById('portal-login-view').style.display = 'none';
    var dashboard = document.getElementById('portal-dashboard');
    dashboard.classList.add('active');
    var initials = ((_portalState.firstName || '?')[0] + (_portalState.lastName || '?')[0]).toUpperCase();
    document.getElementById('portal-avatar').textContent = initials;
    document.getElementById('portal-user-name').textContent = (_portalState.firstName || '') + ' ' + (_portalState.lastName || '');
    document.getElementById('portal-user-email').textContent = _portalState.email;
    document.getElementById('portal-member-id').textContent = _portalState.userId.substring(0, 8) + '...';
    await loadPortalProfile();
    await loadPortalInvestments();
  }

  async function loadPortalProfile() {
    var SUPABASE_URL = window.IVX_SUPABASE_URL || window.SUPABASE_URL || '';
    var SUPABASE_ANON_KEY = window.IVX_SUPABASE_ANON_KEY || window.SUPABASE_ANON_KEY || '';
    if (!_portalState.token || isPlaceholder(SUPABASE_URL)) return;
    try {
      var restUrl = SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/profiles?id=eq.' + _portalState.userId + '&select=*';
      var resp = await fetch(restUrl, { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + _portalState.token } });
      if (!resp.ok) { console.warn('[IVX Portal] Profile fetch failed:', resp.status); return; }
      var profiles = await resp.json();
      if (profiles && profiles.length > 0) {
        var p = profiles[0];
        var kycEl = document.getElementById('portal-kyc-status');
        var kycStatus = p.kyc_status || p.kycStatus || 'pending';
        kycEl.textContent = kycStatus === 'approved' ? 'VERIFIED' : kycStatus === 'in_review' ? 'IN REVIEW' : 'PENDING KYC';
        kycEl.className = 'portal-user-status ' + (kycStatus === 'approved' ? 'active' : 'pending');
        var totalInvested = parseFloat(p.total_invested || p.totalInvested || 0);
        document.getElementById('portal-total-invested').textContent = '$' + totalInvested.toLocaleString();
        var walletBal = parseFloat(p.wallet_balance || p.walletBalance || 0);
        document.getElementById('portal-wallet').textContent = '$' + walletBal.toLocaleString();
        var holdings = parseInt(p.holdings || 0, 10);
        document.getElementById('portal-holdings').textContent = String(holdings);
        var joinedDate = p.created_at || p.createdAt || '';
        if (joinedDate) {
          try { document.getElementById('portal-joined').textContent = new Date(joinedDate).toLocaleDateString(); } catch(e) {}
        }
        if (_portalState.firstName || p.first_name) {
          _portalState.firstName = _portalState.firstName || p.first_name || '';
          _portalState.lastName = _portalState.lastName || p.last_name || '';
          document.getElementById('portal-user-name').textContent = (_portalState.firstName + ' ' + _portalState.lastName).trim();
          var initials2 = ((_portalState.firstName || '?')[0] + (_portalState.lastName || '?')[0]).toUpperCase();
          document.getElementById('portal-avatar').textContent = initials2;
        }
      }
    } catch(err) { console.warn('[IVX Portal] Profile load error:', err.message); }
  }

  async function loadPortalInvestments() {
    var SUPABASE_URL = window.IVX_SUPABASE_URL || window.SUPABASE_URL || '';
    var SUPABASE_ANON_KEY = window.IVX_SUPABASE_ANON_KEY || window.SUPABASE_ANON_KEY || '';
    if (!_portalState.token || isPlaceholder(SUPABASE_URL)) return;
    try {
      var restUrl = SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/landing_investments?investor_id=eq.' + _portalState.userId + '&select=*&order=created_at.desc';
      var resp = await fetch(restUrl, { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + _portalState.token } });
      if (!resp.ok) { console.warn('[IVX Portal] Investments fetch failed:', resp.status); return; }
      var investments = await resp.json();
      var listEl = document.getElementById('portal-investments-list');
      if (!listEl) return;
      if (!investments || investments.length === 0) {
        listEl.innerHTML = '<div class="portal-empty"><div class="portal-empty-icon">&#128188;</div><div>No investments yet</div><div style="font-size:11px;margin-top:6px;">Browse deals and make your first investment</div></div>';
        return;
      }
      var invHtml = '';
      investments.forEach(function(inv) {
        var statusClass = inv.status === 'confirmed' ? 'confirmed' : inv.status === 'cancelled' ? 'cancelled' : 'pending_payment';
        var statusLabel = inv.status === 'confirmed' ? 'CONFIRMED' : inv.status === 'cancelled' ? 'CANCELLED' : 'PENDING';
        invHtml += '<div class="portal-invest-card">' +
          '<div class="portal-invest-top"><div class="portal-invest-deal">' + (inv.deal_title || 'Deal') + '</div><div class="portal-invest-status ' + statusClass + '">' + statusLabel + '</div></div>' +
          '<div class="portal-invest-row"><span class="portal-invest-label">Amount</span><span class="portal-invest-value" style="color:var(--gold);">$' + (inv.amount || 0).toLocaleString() + '</span></div>' +
          '<div class="portal-invest-row"><span class="portal-invest-label">Type</span><span class="portal-invest-value">' + (inv.investment_type || 'JV Direct') + '</span></div>' +
          '<div class="portal-invest-row"><span class="portal-invest-label">Date</span><span class="portal-invest-value">' + (inv.created_at ? new Date(inv.created_at).toLocaleDateString() : '\u2014') + '</span></div>' +
          '</div>';
      });
      listEl.innerHTML = invHtml;
    } catch(err) { console.warn('[IVX Portal] Investments load error:', err.message); }
  }

  function portalLogout() {
    _portalState = { userId: '', email: '', token: '', firstName: '', lastName: '', sb: null };
    try { localStorage.removeItem('ivx_portal_session'); } catch(e) {}
    document.getElementById('portal-login-view').style.display = 'block';
    document.getElementById('portal-dashboard').classList.remove('active');
    document.getElementById('portal-login-form').reset();
  }

  window.IVXPortal = {
    open: openPortal,
    close: closePortal,
    handleLogin: handlePortalLogin,
    logout: portalLogout,
    showDashboard: showPortalDashboard
  };
})(window);
