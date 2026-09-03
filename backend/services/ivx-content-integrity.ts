import { getSB } from '../api/ivx-deal-pathways';

export async function validateDealPhotoCount(dealId: string): Promise<boolean> {
  const sb = await getSB();
  const { data, error } = await sb.from('jv_deals').select('photo_count').eq('id', dealId).single();
  if (error || !data) return false;

  const { data: photos } = await sb.from('deal_photos').select('id').eq('deal_id', dealId);
  return data.photo_count === photos.length;
}
