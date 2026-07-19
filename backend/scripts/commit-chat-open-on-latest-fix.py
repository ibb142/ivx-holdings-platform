import base64, gzip, json, os, sys, urllib.request

AT = open('/tmp/owner_at').read().strip()
API = 'https://api.ivxholding.com/api/ivx/developer-deploy/action'

def gzip_b64(path):
    raw = open(path, 'rb').read()
    comp = gzip.compress(raw, 9)
    return base64.b64encode(comp).decode('ascii')

def plain_b64(path):
    raw = open(path, 'rb').read()
    return base64.b64encode(raw).decode('ascii')

# Files: (repo_path, local_path, encoding, message)
files = [
    ('expo/src/modules/ivx-owner-ai/services/ivxChatService.ts',
     'expo/src/modules/ivx-owner-ai/services/ivxChatService.ts',
     'gzip-base64',
     'OPEN-ON-LATEST BOUNDED LOAD: bound listOwnerMessages DB query to newest 120 (descending then reversed) + cap merged display to newest 160 so the 400-row local mirror cannot re-introduce the slow-layout bug. Fixes chat opening on months-old messages.'),
    ('expo/src/modules/ivx-owner-ai/services/ivxChatOpenOnLatestFix.test.ts',
     'expo/src/modules/ivx-owner-ai/services/ivxChatOpenOnLatestFix.test.ts',
     None,
     'OPEN-ON-LATEST: 9 targeted tests proving the bounded-load display cap keeps the newest window in chronological order with the latest turn as the last element (scroll-to-latest target).'),
    ('expo/app.config.ts',
     'expo/app.config.ts',
     None,
     'v1.4.15(47) buildMarker IVX_BUNDLE_2026_07_19_BUILD_47_CHAT_OPEN_ON_LATEST_BOUNDED_LOAD'),
    ('expo/android/app/build.gradle',
     'expo/android/app/build.gradle',
     None,
     'v1.4.15(47) versionName 1.4.15'),
    ('expo/src/modules/ivx-owner-ai/hooks/useExecutionStatusPoll.ts',
     'expo/src/modules/ivx-owner-ai/hooks/useExecutionStatusPoll.ts',
     None,
     'tsc fix: typecheckRaw narrowed via isRecord guard (was unknown).'),
    ('expo/shared/ivx/types.ts',
     'expo/shared/ivx/types.ts',
     None,
     'tsc fix: add executionStatus? to IVXOwnerAICanonicalResponse (forward through canonical validator).'),
]

results = []
for repo_path, local_path, encoding, message in files:
    content_b64 = gzip_b64(local_path) if encoding == 'gzip-base64' else plain_b64(local_path)
    body = {
        'action': 'github_commit_file',
        'input': {
            'path': repo_path,
            'content': content_b64,
            'message': message,
        },
        'confirm': True,
        'confirmText': 'CONFIRM_IVX_GITHUB_WRITE',
    }
    if encoding:
        body['input']['contentEncoding'] = encoding
    req = urllib.request.Request(
        API,
        data=json.dumps(body).encode('utf-8'),
        headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {AT}'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            sha = data.get('commitSha') or data.get('sha') or data.get('commit', {}).get('sha') or 'NO_SHA'
            print(f'OK {repo_path} -> {sha}')
            results.append((repo_path, sha, 'OK'))
    except urllib.error.HTTPError as e:
        body_text = e.read().decode('utf-8', errors='replace')[:400]
        print(f'FAIL {repo_path} HTTP {e.code} {body_text}')
        results.append((repo_path, f'HTTP{e.code}', 'FAIL'))
    except Exception as e:
        print(f'ERR {repo_path} {e}')
        results.append((repo_path, str(e), 'ERR'))

print('---SUMMARY---')
oks = [r for r in results if r[2] == 'OK']
fails = [r for r in results if r[2] != 'OK']
print(f'OK={len(oks)} FAIL={len(fails)}')
if oks:
    print('LAST_SHA=' + oks[-1][1])
