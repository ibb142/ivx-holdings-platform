import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const workflow = readFileSync(new URL('../.github/workflows/ivx-e2e.yml', import.meta.url), 'utf8');
const block = workflow.split('      - name: Detect mobile-impacting changes\n')[1].split('\n  typecheck:')[0];
const script = block.split('        run: |\n')[1].split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n');
const worker = 'backend/services/ivx-senior-developer-worker.ts';
const landing = 'expo/ivxholding-landing/index.html';

function fixture(change, options = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'ivx-shallow-impact-'));
  const source = path.join(root, 'source'), shallow = path.join(root, 'shallow');
  mkdirSync(source); mkdirSync(shallow);
  const env = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const put = (file, content) => { const target = path.join(source, file); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, content); };
  const commit = message => { git(source, 'add', '.'); git(source, '-c', 'user.name=QA fixture', '-c', 'user.email=qa@example.test', 'commit', '-m', message); };
  try {
    git(source, 'init', '-b', 'main'); put(worker, 'original\n'); put(landing, 'original\n'); commit('base');
    const initialBase = git(source, 'rev-parse', 'HEAD');
    git(source, 'checkout', '-b', 'feature');
    if (change === 'rename') git(source, 'mv', worker, 'worker-moved.txt');
    else put(change === 'worker' ? worker : landing, 'changed\n');
    commit('feature'); const head = git(source, 'rev-parse', 'HEAD');
    git(source, 'checkout', 'main'); put('README.md', 'concurrent base work\n'); commit('advance base');
    const base = git(source, 'rev-parse', 'HEAD');
    git(source, '-c', 'user.name=QA fixture', '-c', 'user.email=qa@example.test', 'merge', '--no-ff', '--no-edit', 'feature');
    const merge = git(source, 'rev-parse', 'HEAD');
    git(shallow, 'init'); git(shallow, 'remote', 'add', 'origin', source);
    git(shallow, 'fetch', '--depth=2', 'origin', 'main'); git(shallow, 'checkout', '--detach', 'FETCH_HEAD');
    assert.equal(git(shallow, 'rev-parse', '--is-shallow-repository'), 'true');
    const output = path.join(root, 'output'); writeFileSync(output, '');
    if (options.nonMerge) git(shallow, 'checkout', '--detach', head);
    const eventBase = options.wrongBase ? head : options.staleBase ? initialBase : base;
    const command = script.replaceAll('${{ github.event.pull_request.base.sha }}', eventBase)
      .replaceAll('${{ github.event.pull_request.head.sha }}', options.wrongHead ? base : head);
    const result = spawnSync('bash', ['-c', command], { cwd: shallow, env: { ...env,
      GITHUB_EVENT_NAME: options.event || 'pull_request',
      GITHUB_SHA: options.wrongSha ? base : options.nonMerge ? head : merge,
      GITHUB_OUTPUT: output, RUNNER_TEMP: root }, encoding: 'utf8' });
    return { status: result.status, diagnostics: result.stdout + result.stderr, output: readFileSync(output, 'utf8') };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

for (const [change, expected] of [['landing', 'false'], ['worker', 'true'], ['rename', 'true']]) {
  test(`the actual workflow classifies ${change} from a shallow PR merge`, () => {
    const result = fixture(change);
    assert.equal(result.status, 0, result.diagnostics);
    assert.equal(result.output.trim(), `mobile=${expected}`);
  });
}
for (const [change, expected] of [['landing', 'false'], ['worker', 'true'], ['rename', 'true']]) {
  test(`an advanced tested base still classifies ${change} with a stale event`, () => {
    const result = fixture(change, { staleBase: true });
    assert.equal(result.status, 0, result.diagnostics);
    assert.equal(result.output.trim(), `mobile=${expected}`);
    assert.match(result.diagnostics, /PR_BASE_ADVANCED=/);
  });
}
for (const [options, message] of [
  [{ wrongBase: true }, /PR base is not an ancestor/],
  [{ wrongHead: true }, /PR head does not match/],
  [{ nonMerge: true }, /Expected the two-parent/],
  [{ wrongSha: true }, null],
]) {
  test(`inconsistent checkout or event cannot suppress mobile QA: ${JSON.stringify(options)}`, () => {
    const result = fixture('landing', options);
    assert.notEqual(result.status, 0);
    assert.equal(result.output, '');
    if (message) assert.match(result.diagnostics, message);
  });
}
for (const event of ['push', 'workflow_dispatch']) {
  test(`${event} keeps the full mobile gate`, () => {
    const result = fixture('landing', { event, wrongBase: true });
    assert.equal(result.status, 0, result.diagnostics);
    assert.equal(result.output.trim(), 'mobile=true');
  });
}
