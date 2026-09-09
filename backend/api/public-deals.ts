import { normalizePublicLandingDeals } from './ivx-public-features';
import { json } from './utilities';

export async function handlePublicDeals(req: Request): Promise<Response> {
  try {
    // Fake Supabase client setup for example
    const sb = await getPublicDealsSB();
    const { data, error } = await sb
      .from('jv_deals')
      .select('id, title, project_name, photos')
      .eq('published', true)
      .order('display_order', { ascending: true });

    if (error) {
      return json({ error: error.message }, 500);
    }

    const deals = normalizePublicLandingDeals(data || []);
    return json({ deals, count: deals.length });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}