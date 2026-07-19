#!/usr/bin/env python3
"""FINAL IVX IA CHAT EXECUTION MODE — commit the 11 changed files via the
owner-gated GitHub API. Large files (>~30KB) use gzip-base64 encoding."""
import json, os, urllib.request, zlib, base64, sys, time

AT = open('/tmp/owner_at').read().strip()
API = 'https://api.ivxholding.com'
CONFIRM = 'CONFIRM_IVX_GITHUB_WRITE'

FILES = [
    ('backend/services/ivx-execution-mode-classifier.ts',
     'IVX IA Chat Execution Mode — intent classifier (10 owner-mandated categories: fix/build/deploy/audit/QA/refactor/migration/create module/create app/senior developer)',
     False),
    ('backend/services/ivx-execution-status-schema.ts',
     'IVX IA Chat Execution Mode — strict 9-field executionStatus payload (taskId/status/stage/liveProgress/filesChanged/tests/commitSha/deploymentId/evidence) + forbidden-narrative phrase guard',
     False),
    ('backend/ivx-execution-mode.test.ts',
     'IVX IA Chat Execution Mode — backend tests (26 cases: 10 categories, narrative gate, 9-field payload, forbidden phrases)',
     False),
    ('expo/shared/ivx/types.ts',
     'IVX IA Chat Execution Mode — add IVXExecutionStatusPayload + IVXExecutionEvidence to IVXOwnerAIResponse shared type',
     False),
    ('expo/src/modules/ivx-owner-ai/hooks/useExecutionStatusPoll.ts',
     'IVX IA Chat Execution Mode — live-polling hook for worker statusUrl (streams stage/progress until terminal evidence)',
     False),
    ('expo/src/modules/ivx-owner-ai/components/ExecutionConsoleBubble.tsx',
     'IVX IA Chat Execution Mode — execution console bubble (live progress bar, stage, files, tests, commitSha, deployId, verified evidence block)',
     False),
    ('expo/src/modules/ivx-owner-ai/services/ivxAIRequestService.ts',
     'IVX IA Chat Execution Mode — forward executionStatus payload through the canonical Owner AI response validator',
     True),
    ('expo/app/ivx/chat.tsx',
     'IVX IA Chat Execution Mode — capture executionStatus on 202 response; render live-polling ExecutionConsoleBubble for execution-mode prompts instead of plain MessageBubble; no narrative planning',
     True),
    ('expo/app.config.ts',
     'IVX IA Chat Execution Mode — bump to v1.4.14(46) buildMarker IVX_BUNDLE_2026_07_19_BUILD_46_IVX_IA_CHAT_EXECUTION_MODE',
     False),
    ('expo/android/app/build.gradle',
     'IVX IA Chat Execution Mode — bump versionCode 46 / versionName 1.4.14',
     False),
    ('backend/api/ivx-owner-ai.ts',
     'IVX IA Chat Execution Mode — enqueue worker job, return HTTP 202 + executionStatus payload immediately (replaces 55s blocking poll); strip forbidden narrative phrases; category classification wired into response',
     True),
]

def commit_file(path, message, use_gzip):
    full = os.path.join('/home/user/rork-app', path)
    raw = open(full, 'rb').read()
    if use_gzip:
        gz = zlib.compress(raw, 9, 31)  # wbits=31 = gzip format
        content = base64.b64encode(gz).decode('ascii')
        encoding = 'gzip-base64'
    else:
        content = raw.decode('utf-8')
        encoding = None
    payload = {
        'action': 'github_commit_file',
        'input': {
            'path': path,
            'content': content,
            'message': message,
        },
        'confirm': True,
        'confirmText': CONFIRM,
    }
    if encoding:
        payload['input']['contentEncoding'] = encoding
    body = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(
        f'{API}/api/ivx/developer-deploy/action',
        data=body,
        headers={'Authorization': f'Bearer {AT}', 'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        resp = urllib.request.urlopen(req, timeout=120)
        out = json.loads(resp.read().decode('utf-8'))
        sha = out.get('commitSha') or out.get('sha') or out.get('commit', {}).get('sha') or 'n/a'
        ok = bool(out.get('ok') or out.get('status') == 'ok' or sha != 'n/a')
        print(f'{"OK " if ok else "?? "} {path} -> {sha}')
        return ok, sha, out
    except urllib.error.HTTPError as e:
        err = e.read().decode('utf-8', 'replace')
        print(f'FAIL {path} HTTP {e.code}: {err[:400]}')
        return False, None, err
    except Exception as e:
        print(f'ERR {path}: {e}')
        return False, None, str(e)

results = []
for path, msg, use_gzip in FILES:
    ok, sha, out = commit_file(path, msg, use_gzip)
    results.append((path, ok, sha))
    time.sleep(0.5)

print('\n=== COMMIT SUMMARY ===')
ok_count = sum(1 for _, ok, _ in results if ok)
print(f'{ok_count}/{len(results)} files committed')
for path, ok, sha in results:
    print(f'  {"OK " if ok else "FAIL"} {sha or "----"} {path}')
sys.exit(0 if ok_count == len(results) else 1)
