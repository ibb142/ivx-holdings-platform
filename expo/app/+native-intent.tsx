export function redirectSystemPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}) {
  if (!path) return '/';

  // Expo Router may hand us either a pathname (/login) or a full custom-scheme URL
  // (ivx-app://login). For custom-scheme URLs, the route can live in the hostname,
  // so preserve it instead of collapsing to '/'.
  try {
    const url = new URL(path, 'ivx-app://app');
    const isCustomScheme = url.protocol === 'ivx-app:';
    const hostRoute = isCustomScheme && url.hostname && url.hostname !== 'app'
      ? `/${url.hostname}`
      : '';
    const pathname = url.pathname && url.pathname !== '/' ? url.pathname : '';
    const route = `${hostRoute}${pathname}` || '/';
    return `${route}${url.search || ''}`;
  } catch {
    return path.startsWith('/') ? path : `/${path}`;
  }
}
