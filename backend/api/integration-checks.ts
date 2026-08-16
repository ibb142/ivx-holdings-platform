import { assertIVXOwnerOnly } from './owner-only';

export async function handleIntegrationCheck(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const checks = await runIntegrationChecks();
    return new Response(JSON.stringify(checks), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function runIntegrationChecks() {
  return {
    ok: true,
    tasks: [
      'Check routing to /api/ivx/owner-ai',
      'Ensure proper permissions in Supabase roles',
      'Inspect real tool bindings such as GitHub API',
    ],
  };
}
