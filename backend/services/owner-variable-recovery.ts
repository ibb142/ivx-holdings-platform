import { query } from '../services/db';
import { OwnerVariableRow } from '../api/ivx-owner-variables';

export async function recoverOwnerVariables(): Promise<OwnerVariableRow[]> {
  const queryText = `SELECT * FROM ivx_owner_variables WHERE status = 'missing'`;
  const result = await query(queryText);
  return result.rows;
}
