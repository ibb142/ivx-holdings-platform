import { describe, expect, it } from 'bun:test';
import { parseFactoryPlan, planFactoryOperationsFromGoal } from './ivx-chat-factory-planner';

describe('ivx-chat-factory-planner', () => {
  it('parses a real multi-file module plan', () => {
    const plan = parseFactoryPlan(
      'Build a new module from scratch for invoices',
      JSON.stringify({ operations: [{ kind: 'create_module', target: 'modules/invoices', reason: 'Create module', files: [{ path: 'modules/invoices/index.ts', content: 'export const invoices = true;\n' }] }] }),
    );
    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]?.kind).toBe('create_module');
  });

  it('rejects unsafe paths', () => {
    expect(() => parseFactoryPlan(
      'Build a new app from scratch',
      JSON.stringify({ operations: [{ kind: 'create_module', reason: 'unsafe', files: [{ path: '../secrets.txt', content: 'x' }] }] }),
    )).toThrow('no executable operations');
  });

  it('rejects migrations unless the owner goal explicitly requests database work', () => {
    expect(() => parseFactoryPlan(
      'Build a new app from scratch',
      JSON.stringify({ operations: [{ kind: 'run_supabase_migration', sql: 'create table x(id int);', migrationName: 'x', reason: 'not requested' }] }),
    )).toThrow('no executable operations');
  });

  it('allows migrations when database work is explicit', () => {
    const plan = parseFactoryPlan(
      'Build a new app from scratch with a Supabase database table',
      JSON.stringify({ operations: [{ kind: 'run_supabase_migration', sql: 'create table x(id int);', migrationName: 'x', reason: 'requested' }] }),
    );
    expect(plan.operations[0]?.kind).toBe('run_supabase_migration');
  });

  it('uses the injected IVX planner caller and accepts fenced JSON', async () => {
    const plan = await planFactoryOperationsFromGoal(
      'Build a new module from scratch',
      async () => '```json\n{"operations":[{"kind":"create_directory","target":"modules/example","reason":"scaffold"}]}\n```',
    );
    expect(plan.planner).toBe('ivx_ai');
    expect(plan.operations[0]?.kind).toBe('create_directory');
  });
});
