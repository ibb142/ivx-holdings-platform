import { pathToFileURL } from 'node:url';
import { appendFile } from 'node:fs/promises';
class BindingError extends Error {}

export async function bindOwnerRuntime({ env = process.env, fetchImpl = fetch } = {}) {
  const serviceId = env.SERVICE_ID;
  const renderKey = env.RENDER_API_KEY_RECOVERED;
  const ownerPassword = env.IVX_OWNER_PASSWORD || env.OWNER_NEW_PASSWORD;
  const email = env.OWNER_EMAIL?.trim().toLowerCase();
  const supabaseUrl = env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '');
  const anon = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (serviceId !== 'srv-d7t9ivreo5us73ftose0' || supabaseUrl !== 'https://kvclcdjmjghndxsngfzb.supabase.co') throw new BindingError('Audited service/project identity mismatch');
  if (!renderKey || !ownerPassword || !email || !anon) throw new BindingError('Owner runtime binding inputs missing');
  // Verify the existing Owner credential; never reset a password or assign a role.
  const auth = await fetchImpl(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: ownerPassword }), signal: AbortSignal.timeout(20000),
  });
  if (!auth.ok) throw new BindingError(`Owner authentication failed: HTTP ${auth.status}`);
  const { user } = await auth.json();
  if (!user?.id || user.email?.toLowerCase() !== email || !['owner', 'admin'].includes(user.app_metadata?.role)) throw new BindingError('Authenticated identity is not the configured Owner');
  const headers = { Authorization: `Bearer ${renderKey}`, 'Content-Type': 'application/json' };
  const changedKeys = [];
  let uncertainWritesVerified = 0;
  for (const [key, value] of [['IVX_OWNER_PASSWORD', ownerPassword], ['OWNER_NEW_PASSWORD', ownerPassword], ['IVX_OWNER_EMAIL', email], ['IVX_OWNER_PASSWORD_BASE64', Buffer.from(ownerPassword, 'utf8').toString('base64')]]) {
    const url = `https://api.render.com/v1/services/${serviceId}/env-vars/${key}`;
    const read = async () => {
      const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(15000) });
      if (response.status === 404) return undefined;
      if (!response.ok) throw new BindingError(`Render binding read failed: HTTP ${response.status}`);
      const row = await response.json();
      return (row.envVar || row).value;
    };
    if (await read() === value) continue;
    let response;
    try { response = await fetchImpl(url, { method: 'PUT', headers, body: JSON.stringify({ value }), signal: AbortSignal.timeout(15000) }); }
    catch { /* An uncertain write is checked by a read; it is never replayed. */ }
    if (response && !response.ok) throw new BindingError(`Render binding update rejected: HTTP ${response.status}`);
    if (await read() !== value) throw new BindingError('Owner binding not verified; deployment must remain blocked');
    if (!response) uncertainWritesVerified++;
    changedKeys.push(key);
  }
  return { ownerAuthenticated: true, changed: changedKeys.length > 0, changedKeys, uncertainWritesVerified, secretValuesReturned: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const receipt = await bindOwnerRuntime();
    console.log(JSON.stringify(receipt));
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `changed=${receipt.changed}\n`);
  } catch (error) { console.error(error instanceof BindingError ? error.message : 'Owner runtime binding unavailable; deployment remains blocked'); process.exitCode = 1; }
}
