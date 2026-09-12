const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read persisted viewer state without sending guest identifiers to UUID columns. */
export async function loadViewerEngagement(
  sb: any,
  projectIds: string[],
  viewerId: string | null,
): Promise<{ liked: Set<string>; saved: Set<string> }> {
  if (!viewerId || projectIds.length === 0) {
    return { liked: new Set(), saved: new Set() };
  }

  const read = (table: string) => {
    const query = sb.from(table).select('project_id').in('project_id', projectIds);
    // UUID viewers can be authenticated users or older guest identities. Other
    // guest values must use an exact value filter, never PostgREST OR syntax.
    return UUID.test(viewerId)
      ? query.or(`user_id.eq.${viewerId},guest_id.eq.${viewerId}`)
      : query.eq('guest_id', viewerId);
  };

  const [likes, saves] = await Promise.all([read('project_likes'), read('project_saves')]);
  if (likes.error || saves.error) {
    // An unavailable read is not evidence that the viewer unliked/unsaved items.
    throw new Error('Viewer engagement read unavailable');
  }
  return {
    liked: new Set((likes.data || []).map((row: { project_id: string }) => String(row.project_id))),
    saved: new Set((saves.data || []).map((row: { project_id: string }) => String(row.project_id))),
  };
}
