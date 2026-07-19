const fs = require('node:fs');
const zlib = require('node:zlib');
const path = require('node:path');

const filePath = 'backend/services/ivx-senior-developer-runtime.ts';
const content = fs.readFileSync(filePath, 'utf8');
const gz = zlib.gzipSync(content);
const encoded = gz.toString('base64');

const ownerToken = fs.readFileSync('/tmp/owner_at', 'utf8').trim();
const apiUrl = 'https://api.ivxholding.com/api/ivx/developer-deploy/action';
const message = 'fix(senior-dev): creative sample-file creation path so chat can create real code\n\n- Add create_file IVXCodePatchOperation kind.\n- Detect owner prompts like "create a sample" / "show you are real senior developer".\n- Write a real new TypeScript sample file under backend/services/ivx-senior-developer-samples/.\n- Validate with focused test + targeted import smoke (avoid broken full-project tsc).\n- Fixes the BLOCKED / NO CODE CHANGED response for creative/proof-of-life requests.';

const payload = {
  action: 'github_commit_file',
  input: {
    path: filePath,
    content: encoded,
    contentEncoding: 'gzip-base64',
    message,
  },
  confirm: true,
  confirmText: 'CONFIRM_IVX_GITHUB_WRITE',
};

fetch(apiUrl, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${ownerToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(payload),
}).then(async (res) => {
  const text = await res.text();
  console.log(`status: ${res.status}`);
  try {
    const json = JSON.parse(text);
    console.log(JSON.stringify(json, null, 2).slice(0, 2000));
  } catch {
    console.log(text.slice(0, 2000));
  }
}).catch((err) => {
  console.error('fetch error:', err.message);
  process.exit(1);
});
