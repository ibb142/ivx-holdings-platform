import { Context } from 'hono';

export async function getPublicDeals(c: Context): Promise<Response> {
  // Simulate fetching deals
  const deals = [
    {
      id: 'JV-202603-5190',
      photos: Array(9).fill('https://example.com/photo.jpg'),
      state: 'published'
    }
  ];

  return c.json({
    ok: true,
    deals,
  });
}

export async function getLandingConfig(c: Context): Promise<Response> {
  return c.json({
    ok: true,
    config: {}
  });
}

export async function getLandingVideos(c: Context): Promise<Response> {
  return c.json({
    ok: true,
    videos: []
  });
}
