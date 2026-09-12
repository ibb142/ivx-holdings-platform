import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

export async function installLandingPreviewRoutes(context, base, preview, root = path.resolve('expo/ivxholding-landing')) {
  assert.equal(preview.hostname, '127.0.0.1');
  const origin = new URL(base).origin, files = new Set();
  async function visit(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const pathname = prefix + '/' + encodeURIComponent(entry.name);
      if (entry.isDirectory()) await visit(path.join(directory, entry.name), pathname);
      else if (entry.isFile()) files.add(pathname);
    }
  }
  await visit(root);
  if (files.has('/index.html')) files.add('/');
  // Preserve the existing read-only guard. Dynamic requests fall through to
  // Playwright's normal network handling without awaiting a preview lookup.
  await context.route(origin + '/**', async route => {
    assert.ok(['GET', 'HEAD'].includes(route.request().method()), 'Static preview cannot perform public writes');
    await route.fallback();
  });
  await context.route(url => url.origin === origin && files.has(url.pathname),
    route => forwardLandingPreviewRoute(context, preview, route));
}

// Forward only static PR assets; missing media/API files retain their real origin.
export async function forwardLandingPreviewRoute(context, preview, route) {
  assert.equal(preview.hostname, '127.0.0.1');
  const request = route.request(), url = new URL(request.url());
  assert.ok(['GET', 'HEAD'].includes(request.method()), 'Static preview cannot perform public writes');
  const response = await context.request.fetch(preview.origin + url.pathname + url.search, { method: request.method() });
  try {
    if (response.status() === 404) await route.continue();
    else await route.fulfill({ response });
  } catch (error) {
    // Playback/navigation can cancel this request while the local lookup is
    // pending. Ignore only a duplicate terminal action on a confirmed abort;
    // active-route failures and all other errors must still fail acceptance.
    const alreadyHandled = /^(?:route\.(?:continue|fulfill): )?Route is already handled!$/.test(error.message || '');
    if (!alreadyHandled || request.failure()?.errorText !== 'net::ERR_ABORTED') throw error;
  } finally {
    await response.dispose();
  }
}
