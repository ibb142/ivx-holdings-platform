import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { loadAgentState } from './agent-durable-store';

const DIR = path.join(process.cwd(), 'logs', 'audit', 'agent-state');
const STATE_PATH = path.join(DIR, 'agent-state.json');

async function setupInvalidState() {
  await mkdir(DIR, { recursive: true });
  await writeFile(STATE_PATH, '[{"invalid": "data"}]', 'utf8');
}

test('loadAgentState handles invalid state gracefully', async () => {
  await setupInvalidState();
  const state = await loadAgentState();
  assert.strictEqual(state, null, 'State should be null when invalid data');
});
