// PR browser preview: current static source and the existing public read API.
// This preview is not evidence of a production deployment.
import path from 'node:path';
const root = path.resolve('expo/ivxholding-landing');
Bun.serve({ hostname: '127.0.0.1', port: 4175, async fetch(request) {
  const url = new URL(request.url);
  const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(root + path.sep) || !await Bun.file(file).exists()) return new Response(null, { status: 404 });
  if (file.endsWith('/index.html')) {
    const html = (await Bun.file(file).text())
      .replace(/__IVX_(?:API_BASE_URL|BACKEND_URL)__/g, 'https://api.ivxholding.com')
      .replace(/__IVX_[A-Z_]+__/g, '');
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  return new Response(Bun.file(file));
} });
