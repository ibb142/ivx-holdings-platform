// Preserve native destinations; route layouts still enforce authentication.
function normalizeSystemPath(path: string): string {
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

export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  const destination = normalizeSystemPath(path);
  // Only these static regression destinations are logged. Never log incoming
  // links, query parameters, fragments, credentials, or dynamic route IDs.
  const pathname = destination.split(/[?#]/, 1)[0];
  if (['/chat-hub', '/admin/waitlist-admin', '/app-guide'].includes(pathname)) {
    console.info('[IVX Native Route]', { stage: 'normalized', destination: pathname, initial });
  }
  return destination;
}
