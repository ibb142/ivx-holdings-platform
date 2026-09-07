/** Preserve native link destinations for both cold launches and the running app.
 * Expo Router parses the URL and the existing route guards verify access.
 * Replacing every link with `/` silently sent Dashboard and Chat back to Home.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  return typeof path === 'string' && path.trim().length > 0 ? path : '/';
}
