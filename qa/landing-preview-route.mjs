import assert from 'node:assert/strict';

export async function installLandingPreviewRoute(context, base, previewSource) {
  const preview = new URL(previewSource);
  assert.equal(preview.hostname, '127.0.0.1');
  await context.route(new URL(base).origin + '/**', async (route) => {
    const request = route.request(), url = new URL(request.url());
    assert.ok(['GET', 'HEAD'].includes(request.method()), 'Static preview cannot perform public writes');
    // Public API and media are owned by the edge, not the static checkout.
    // Forward them before an asynchronous local lookup can outlive a cancelled
    // media request. Preserve real errors, MIME types and range responses.
    if (/^\/(?:api|videos|media)(?:\/|$)/.test(url.pathname)) return route.continue();
    const response = await context.request.fetch(preview.origin + url.pathname + url.search, { method: request.method() });
    if (response.status() === 404) return route.continue();
    await route.fulfill({ response });
  });
}
