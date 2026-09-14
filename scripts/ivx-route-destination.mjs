import { pathToFileURL } from 'node:url';

// These routes redirect automatically for the authenticated owner used by the
// certificate. Other routes must display their own destination, never login.
const ownerRedirects = new Map([
  ['/', '/home'],
  ['/login', '/home'],
  ['/owner-access', '/home'],
  ['/verify-access', '/home'],
  ['/ivx', '/ivx/inbox'],
  ['/admin/member', '/admin/members'],
]);

export function expectedRoutePath(route) {
  return ownerRedirects.get(route) ?? route;
}

export function routeDestinationId(route) {
  return '^ivx-current-route' + expectedRoutePath(route).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(routeDestinationId(process.argv[2]));
}
