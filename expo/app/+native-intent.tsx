/** Preserve native link destinations for both cold launches and the running app.
 * Expo Router parses non-root URLs and the existing route guards verify access.
 * Normalize the custom-scheme root so restart recovery returns to the tab shell.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  if (typeof path !== 'string') return '/';

  const normalizedPath = path.trim();
  if (normalizedPath.length === 0 || normalizedPath === 'ivx-app:///') return '/';

  return normalizedPath;
}
