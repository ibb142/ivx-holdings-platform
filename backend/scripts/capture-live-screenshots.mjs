import { mkdirSync, writeFileSync } from 'node:fs';

const OWNER_TOKEN = process.env.IVX_OWNER_TOKEN || '';
const API = 'https://api.ivxholding.com';
const OUT = 'screenshots/live-deploy-2026-07-06';

mkdirSync(OUT, { recursive: true });

const shots = [
  { name: '01-landing-mobile', url: 'https://ivxholding.com', viewport: { width: 390, height: 844 }, fullPage: false, waitMs: 2500 },
  { name: '02-chat-mobile', url: 'https://chat.ivxholding.com', viewport: { width: 390, height: 844 }, fullPage: false, waitMs: 3000 },
  { name: '03-chat-desktop', url: 'https://chat.ivxholding.com', viewport: { width: 1280, height: 800 }, fullPage: false, waitMs: 3000 },
  { name: '04-members-route', url: 'https://chat.ivxholding.com/ivx/master-lead-list', viewport: { width: 390, height: 844 }, fullPage: false, waitMs: 3000 },
  { name: '05-investors-route', url: 'https://chat.ivxholding.com/ivx/investors', viewport: { width: 390, height: 844 }, fullPage: false, waitMs: 3000 },
];

async function capture(shot) {
  const res = await fetch(`${API}/api/ivx/qa/screenshot`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OWNER_TOKEN}`,
    },
    body: JSON.stringify(shot),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { ok: false, parseError: text.slice(0, 200) }; }
  const base64 = data?.pngBase64;
  if (data?.ok && base64 && typeof base64 === 'string') {
    const buf = Buffer.from(base64, 'base64');
    const path = `${OUT}/${shot.name}.png`;
    writeFileSync(path, buf);
    return { ok: true, name: shot.name, path, bytes: buf.length, title: data.title, savedPath: data.savedPath, responseLength: text.length };
  }
  return { ok: false, name: shot.name, status: res.status, responseLength: text.length, error: data?.error || 'no pngBase64', sample: text.slice(0, 200) };
}

async function main() {
  const results = [];
  for (const shot of shots) {
    const result = await capture(shot);
    results.push(result);
    console.log(JSON.stringify(result));
  }
  writeFileSync(`${OUT}/capture-results.json`, JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });