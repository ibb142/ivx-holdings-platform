#!/usr/bin/env python3
"""Commit a batch of IVX brand standardization files to GitHub via the IVX API."""
import json
import gzip
import base64
import sys
import urllib.request
import urllib.error
from pathlib import Path

files = sys.argv[1:] if len(sys.argv) > 1 else []
if not files:
    print("Usage: python3 tmp_commit_brand_batch.py <file1> <file2> ...")
    sys.exit(1)

token_path = Path('/tmp/owner_at.json')
token = json.loads(token_path.read_text())['accessToken']

api_url = 'https://api.ivxholding.com/api/ivx/developer-deploy/action'
headers = {
    'Authorization': f'Bearer {token}',
    'Content-Type': 'application/json',
}

commit_message = 'IVX Global Brand Standardization: official logo end-to-end, remove Crown icons, update app icon/splash/favicon, update landing page assets'

for path in files:
    p = Path(path)
    if not p.exists():
        print(f'SKIP (missing): {path}')
        continue
    raw = p.read_bytes()
    compressed = gzip.compress(raw)
    encoded = base64.b64encode(compressed).decode('ascii')
    payload = {
        'action': 'github_commit_file',
        'input': {
            'path': path,
            'content': encoded,
            'contentEncoding': 'gzip-base64',
            'message': commit_message,
        },
        'confirm': True,
        'confirmText': 'CONFIRM_IVX_GITHUB_WRITE',
    }
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(api_url, data=data, headers=headers, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode('utf-8')
            print(f'OK {path}: {resp.status} {body[:120]}')
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8')
        print(f'FAIL {path}: {e.code} {body[:200]}')
        sys.exit(1)
