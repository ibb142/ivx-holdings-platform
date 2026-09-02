import { executeSqlViaPg } from './ivx-agent-jobs';
import { json } from './ivx-agent-code-executor';

export async function handleAgentCycle401Request(): Promise<Response> {
  try {
    await executeSqlViaPg('SELECT * FROM agent_cycles WHERE duty = 401');
    return json({ ok: true, message: 'Agent cycle 401 executed successfully.' });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'Unknown error occurred.' }, 500);
  }
}