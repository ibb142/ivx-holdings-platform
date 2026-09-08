import { assertIVXOwnerOnly, ownerOnlyJson } from '../api/owner-only';
import { OWNER_VARIABLES } from '../api/ivx-owner-variables';
import { getPgPool } from '../services/db';

export async function ownerVariableRecoveryWorkflow(request: Request): Promise<Response> {
  const auth = await assertIVXOwnerOnly(request);
  if (!auth.ok) return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);

  try {
    const pool = getPgPool();
    const client = await pool.connect();

    try {
      const { rows } = await client.query('SELECT * FROM ivx_owner_variables');
      const response = OWNER_VARIABLES.map(variable => {
        const row = rows.find(r => r.name === variable.name);
        return row ? {
          name: row.name,
          status: 'retrieved',
          provider: row.provider,
          last_tested_at: row.last_tested_at,
        } : {
          name: variable.name,
          status: 'missing',
        };
      });
      return ownerOnlyJson({ ok: true, variables: response });
    } finally {
      client.release();
    }
  } catch (error) {
    return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to recover owner variables.' }, 500);
  }
}
