import { listDeals } from './ivx-deal-tracking-store';

export async function auditMediaIntegrity(): Promise<void> {
  const deals = await listDeals();
  for (const deal of deals) {
    const storedPhotos = deal.storedPhotos || [];
    const linkedPhotos = deal.linkedPhotos || [];

    if (storedPhotos.length !== linkedPhotos.length) {
      console.warn(`Media count drift detected for deal ${deal.id}: ` +
                   `${storedPhotos.length} stored vs ${linkedPhotos.length} linked photos.`);
      // Add logic to automatically repair low-risk media defects here
    }
  }
}
