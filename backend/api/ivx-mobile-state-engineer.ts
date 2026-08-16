import { assertIVXOwnerOnly, ownerOnlyJson } from './owner-only';
import { getMobileStateEngineerReadiness } from '../services/ivx-mobile-state-engineer';

export async function handleMobileStateEngineerVerification(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const readiness = await getMobileStateEngineerReadiness();
    return ownerOnlyJson({ ok: true, readiness });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Verification failed.';
    return ownerOnlyJson({ ok: false, error: message }, 500);
  }
}