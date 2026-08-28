import { execFileSync } from 'node:child_process';

const base = process.env.GITHUB_BASE_REF
  ? `origin/${process.env.GITHUB_BASE_REF}`
  : (process.env.IVX_SEMANTIC_BASE || 'HEAD~1');

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
}

let changed = [];
try {
  changed = git(['diff', '--name-only', `${base}...HEAD`])
    .split('\n').map((s) => s.trim()).filter(Boolean)
    .filter((p) => /^(backend|expo)\/.+\.(ts|tsx|js|jsx|mjs)$/.test(p));
} catch (error) {
  console.error(`SEMANTIC_GATE_FAIL: cannot compute diff against ${base}: ${error.message}`);
  process.exit(1);
}

const forbidden = [
  { name: 'TODO marker', re: /\bTODO\b/i },
  { name: 'FIXME marker', re: /\bFIXME\b/i },
  { name: 'placeholder marker', re: /\bplaceholder\b/i },
  { name: 'not implemented marker', re: /\bnot\s+implemented\b/i },
  { name: 'add real logic marker', re: /\badd\s+real\s+(?:binding\s+)?logic\b/i },
  { name: 'implement real logic marker', re: /\bimplement\s+real\s+(?:binding\s+)?logic\b/i },
  { name: 'example-only function', re: /\bfunction\s+(?:example|sample|demo)[A-Za-z0-9_]*\s*\(/i },
];

const failures = [];
for (const file of changed) {
  let added = '';
  try {
    added = git(['diff', '--unified=0', `${base}...HEAD`, '--', file])
      .split('\n')
      .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
      .map((line) => line.slice(1))
      .join('\n');
  } catch (error) {
    failures.push(`${file}: unable to inspect added lines: ${error.message}`);
    continue;
  }
  for (const rule of forbidden) {
    if (rule.re.test(added)) failures.push(`${file}: ${rule.name}`);
  }
}

if (failures.length) {
  console.error('SEMANTIC_GATE_FAIL: autonomous patch contains non-production placeholder/example evidence:');
  for (const failure of failures) console.error(`- ${failure}`);
  console.error('Replace placeholders with real behavior and task-specific verification before merge.');
  process.exit(1);
}

console.log(`SEMANTIC_GATE_PASS: inspected ${changed.length} changed implementation file(s); no forbidden placeholder/example additions found.`);
