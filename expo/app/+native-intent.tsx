// Preserve native destinations; route layouts still enforce authentication.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (path.startsWith('/') && !path.startsWith('//')) return path;
    const url = new URL(path);
    if (url.username || url.password) return '/';
    if (url.protocol === 'ivx-app:') {
      return `/${[url.hostname, url.pathname.replace(/^\/+/, '')].filter(Boolean).join('/')}${url.search}${url.hash}`;
    }
    if (url.protocol === 'https:' && ['chat.ivxholding.com', 'ivxholding.com', 'www.ivxholding.com'].includes(url.host)) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
  } catch { /* Invalid external links return to the app shell. */ }
  return '/';
}
