/** Feed metadata is a prerequisite for playback, never proof of decoded video. */
export function observeReelsFeed(status: number, body: unknown, dataState?: string) {
  const payload = body !== null && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown> : null;
  const dataAvailable = typeof payload?.data_available === 'boolean' ? payload.data_available : null;
  const degraded = payload?.degraded === true || payload?.status === 'DEGRADED';
  // The production client accepts an available cached feed while optional
  // dependencies are degraded. Explicit unavailability always takes priority.
  const unavailable = !payload || payload.ok === false || dataAvailable === false
    || (degraded && dataAvailable !== true)
    || payload.code === 'PUBLIC_DATA_UNAVAILABLE' || dataState === 'unavailable';
  const videoCount = Array.isArray(payload?.videos) ? payload.videos.length : 0;
  // Only an explicit HTTP 200 availability response can defer the smoke test.
  // Authentication, malformed payloads and unexpected API errors still fail.
  const dependencyUnavailable = status === 200 && !!payload && unavailable
    && (payload.data_available == null || typeof payload.data_available === 'boolean')
    && (payload.degraded == null || typeof payload.degraded === 'boolean')
    && (dataAvailable === false || degraded || dataState === 'unavailable'
      || payload.code === 'PUBLIC_DATA_UNAVAILABLE')
    && (payload.code == null || payload.code === 'PUBLIC_DATA_UNAVAILABLE')
    && dataAvailable !== true;
  return {
    status, degraded, dataAvailable, unavailable, videoCount, dependencyUnavailable,
    playbackCandidate: status >= 200 && status < 300 && !unavailable && videoCount > 0,
  };
}

export function canDeferReelsPlayback(observations: Array<ReturnType<typeof observeReelsFeed>>) {
  return observations.length > 0 && observations.every(value => value.dependencyUnavailable);
}
