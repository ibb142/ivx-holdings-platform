import { json } from './utilities';

export async function handlePublicVideos(req: Request): Promise<Response> {
  try {
    // Mock implementation
    return json({ videos: [] }, 200);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}