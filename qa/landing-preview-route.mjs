import assert from 'node:assert/strict';

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
