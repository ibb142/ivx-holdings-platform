/** Unavailable render fallbacks must remain errors so callers retain data and retry. */
export async function readAvailableFeed<T>(response: Response, collection: 'blocks' | 'videos'): Promise<T> {
  if (!response.ok) throw new Error(`Feed request failed (${response.status})`);
  const payload = await response.json();
  if (response.headers.get('X-IVX-Data-State') === 'unavailable'
    || payload?.data_available === false || payload?.code === 'PUBLIC_DATA_UNAVAILABLE') {
    throw new Error('Public feed temporarily unavailable');
  }
  if (!payload || !Array.isArray(payload[collection])) throw new Error('Invalid public feed response');
  return payload as T;
}
