/**
 * REAL LIVE AUDIT — visitor + member truth from day one to now.
 * No fabrication. Queries live Supabase + live Render backend + live landing page.
 */
const SUPABASE_URL = 'https://kvclcdjmjghndxsngfzb.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BACKEND = 'https://api.ivxholding.com';
const OWNER_TOKEN = process.env.IVX_OWNER_TOKEN || '';
const LANDING = 'https://ivxholding.com';

const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json' };

async function countTable(table) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id`, {
      method: 'HEAD',
      headers: { ...headers, Prefer: 'count=exact', Range: '0-0' },
    });
    if (res.status === 404) return { table, count: null, status: 404, error: 'TABLE_NOT_FOUND' };
    const cr = res.headers.get('content-range');
    const total = cr ? parseInt(cr.split('/').pop(), 10) : null;
    return { table, count: total, status: res.status, error: null };
  } catch (e) {
    return { table, count: null, status: null, error: e.message };
  }
}

async function queryAll(table, select = '*', order = 'created_at.asc', limit = 5000) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=${select}&order=${order}&limit=${limit}`, { headers });
    if (!res.ok) return { rows: [], status: res.status, error: `HTTP ${res.status}` };
    const rows = await res.json();
    return { rows, status: res.status, error: null };
  } catch (e) {
    return { rows: [], status: null, error: e.message };
  }
}

async function rpc(fn, params = {}) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, body: text.slice(0, 500) };
  } catch (e) {
    return { ok: false, status: null, body: e.message };
  }
}

async function askOwnerAI(message) {
  try {
    const res = await fetch(`${BACKEND}/api/ivx/owner-ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ivx-owner-token': OWNER_TOKEN },
      body: JSON.stringify({ message }),
    });
    const text = await res.text();
    return { status: res.status, body: text.slice(0, 1200) };
  } catch (e) {
    return { status: null, body: e.message };
  }
}

async function askPublicAI(message) {
  try {
    const res = await fetch(`${BACKEND}/api/public/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    const text = await res.text();
    return { status: res.status, body: text.slice(0, 1200) };
  } catch (e) {
    return { status: null, body: e.message };
  }
}

async function getLanding() {
  try {
    const res = await fetch(LANDING);
    const html = await res.text();
    // Search for hardcoded member/visitor counts
    const matches = [];
    const patterns = [
      /\d{1,4}\s*(?:members?|investors?|visitors?|joined|waitlist|people)/gi,
      /(?:members?|investors?|visitors?|joined|waitlist|people)\s*[:\-]?\s*\d{1,4}/gi,
      /\b1[,.]?050\b/g,
      /\b1050\b/g,
    ];
    for (const p of patterns) {
      let m;
      while ((m = p.exec(html)) !== null) {
        matches.push(m[0]);
      }
    }
    // Get the waitlist-count section
    const waitlistCountMatch = html.match(/waitlist-count[^>]*>[\s\S]*?<strong[^>]*>([^<]+)<\/strong>/i);
    const funnelMembersMatch = html.match(/funnel-members-text[^>]*>[\s\S]*?<strong[^>]*>([^<]+)<\/strong>/i);
    return {
      status: res.status,
      size: html.length,
      hardcodedCountMatches: [...new Set(matches)].slice(0, 20),
      waitlistCountSection: waitlistCountMatch ? waitlistCountMatch[1] : 'NOT_FOUND',
      funnelMembersSection: funnelMembersMatch ? funnelMembersMatch[1] : 'NOT_FOUND',
    };
  } catch (e) {
    return { status: null, error: e.message };
  }
}

async function main() {
  const out = {};
  out.timestamp = new Date().toISOString();

  // 1. Count every relevant table
  const tables = [
    'visitor_sessions', 'landing_analytics', 'analytics_events', 'analytics_dashboard',
    'analytics_kpi', 'analytics_retention', 'analytics_investments', 'utm_analytics',
    'realtime_snapshots', 'waitlist', 'members', 'investors', 'buyers', 'jv_deals',
    'private_lenders', 'tokenized_investments', 'wallets', 'treasury', 'ledger',
    'withdrawals', 'wire_transfers', 'kyc', 'notifications',
  ];
  out.tableCounts = {};
  for (const t of tables) {
    out.tableCounts[t] = await countTable(t);
  }

  // 2. Visitor sessions: date range + sample
  const vsData = await queryAll('visitor_sessions', 'session_id,created_at,last_seen_at,page_path,device_type,country,city', 'created_at.asc', 5000);
  out.visitorSessions = {
    totalRows: vsData.rows.length,
    status: vsData.status,
    error: vsData.error,
    firstSeen: vsData.rows.length > 0 ? vsData.rows[0].created_at : null,
    lastSeen: vsData.rows.length > 0 ? vsData.rows[vsData.rows.length - 1].last_seen_at : null,
    sample: vsData.rows.slice(0, 5),
  };

  // 3. Landing analytics: date range + event breakdown
  const laData = await queryAll('landing_analytics', 'id,created_at,event,page_path,session_id', 'created_at.asc', 5000);
  const eventBreakdown = {};
  for (const r of laData.rows) {
    eventBreakdown[r.event] = (eventBreakdown[r.event] || 0) + 1;
  }
  out.landingAnalytics = {
    totalRows: laData.rows.length,
    status: laData.status,
    error: laData.error,
    firstSeen: laData.rows.length > 0 ? laData.rows[0].created_at : null,
    lastSeen: laData.rows.length > 0 ? laData.rows[laData.rows.length - 1].created_at : null,
    eventBreakdown,
    sample: laData.rows.slice(0, 5),
  };

  // 4. Analytics events: date range + event breakdown
  const aeData = await queryAll('analytics_events', 'id,created_at,event,user_id,session_id', 'created_at.asc', 5000);
  const aeBreakdown = {};
  for (const r of aeData.rows) {
    aeBreakdown[r.event] = (aeBreakdown[r.event] || 0) + 1;
  }
  out.analyticsEvents = {
    totalRows: aeData.rows.length,
    status: aeData.status,
    error: aeData.error,
    firstSeen: aeData.rows.length > 0 ? aeData.rows[0].created_at : null,
    lastSeen: aeData.rows.length > 0 ? aeData.rows[aeData.rows.length - 1].created_at : null,
    eventBreakdown: aeBreakdown,
    sample: aeData.rows.slice(0, 5),
  };

  // 5. Waitlist: real entries
  const wlData = await queryAll('waitlist', '*', 'created_at.asc', 5000);
  out.waitlist = {
    totalRows: wlData.rows.length,
    status: wlData.status,
    error: wlData.error,
    firstSeen: wlData.rows.length > 0 ? (wlData.rows[0].created_at || 'no created_at') : null,
    lastSeen: wlData.rows.length > 0 ? (wlData.rows[wlData.rows.length - 1].created_at || 'no created_at') : null,
    rows: wlData.rows.slice(0, 20).map(r => ({ id: r.id, email: r.email, name: r.name, created_at: r.created_at, source: r.source })),
  };

  // 6. Members: real entries
  const memData = await queryAll('members', 'id,email,first_name,last_name,created_at,role', 'created_at.asc', 5000);
  out.members = {
    totalRows: memData.rows.length,
    status: memData.status,
    error: memData.error,
    firstSeen: memData.rows.length > 0 ? memData.rows[0].created_at : null,
    rows: memData.rows.slice(0, 20),
  };

  // 7. Auth users (via admin API)
  try {
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, { headers });
    const authData = await authRes.json();
    out.authUsers = {
      status: authRes.status,
      total: authData.users ? authData.users.length : 0,
      users: (authData.users || []).slice(0, 30).map(u => ({ id: u.id, email: u.email, created_at: u.created_at, email_confirmed: u.email_confirmed_at ? true : false })),
    };
  } catch (e) {
    out.authUsers = { error: e.message };
  }

  // 8. Backend members count endpoint
  try {
    const mcRes = await fetch(`${BACKEND}/api/ivx/members/count`);
    out.backendMembersCount = { status: mcRes.status, body: (await mcRes.text()).slice(0, 500) };
  } catch (e) {
    out.backendMembersCount = { error: e.message };
  }

  // 9. Backend health
  try {
    const hRes = await fetch(`${BACKEND}/health`);
    out.backendHealth = { status: hRes.status, body: (await hRes.text()).slice(0, 300) };
  } catch (e) {
    out.backendHealth = { error: e.message };
  }

  // 10. Landing page hardcoded counts
  out.landing = await getLanding();

  // 11. Owner AI: ask "how many members" live
  out.ownerAI_howManyMembers = await askOwnerAI('How many members do we have on the platform right now?');

  // 12. Owner AI: ask "how many visitors from day one"
  out.ownerAI_howManyVisitors = await askOwnerAI('How many visitors has the landing page had from day one to now?');

  // 13. Public AI: ask "how many members"
  out.publicAI_howManyMembers = await askPublicAI('How many members does IVXHOLDINGS have?');

  // 14. Realtime snapshots
  const rsData = await queryAll('realtime_snapshots', 'id,created_at,snapshot_type,active_visitors', 'created_at.desc', 50);
  out.realtimeSnapshots = {
    totalRows: rsData.rows.length,
    status: rsData.status,
    sample: rsData.rows.slice(0, 10),
  };

  console.log(JSON.stringify(out, null, 2));
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });