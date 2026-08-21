export function redirectSystemPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}) {
  // Preserve valid Expo Router deep-link destinations instead of forcing
  // every incoming system path back to '/'. This allows canonical links
  // such as ivx-app://login to resolve to /login during native launch QA
  // and in production deep-link flows.
  if (!path) return '/';

  try {
    const url = new URL(path, 'ivx-app://app');
    const pathname = url.pathname || '/';
    const search = url.search || '';
    return `${pathname}${search}`;
  } catch {
    return path.startsWith('/') ? path : `/${path}`;
  }
}
