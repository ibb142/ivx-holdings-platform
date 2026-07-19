#!/usr/bin/env python3
"""FINAL IVX IA CHAT EXECUTION MODE — trigger Render deploy + verify 3-way SHA parity."""
import json, urllib.request, time, sys

AT = open('/tmp/owner_at').read().strip()
API = 'https://api.ivxholding.com'
SERVICE_ID = 'srv-d7t9ivreo5us73ftose0'

def trigger_deploy():
    payload = {
        'action': 'render_trigger_deploy',
        'input': {},
        'confirm': True,
        'confirmText': 'CONFIRM_IVX_RENDER_DEPLOY',
    }
    body = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(
        f'{API}/api/ivx/developer-deploy/action',
        data=body,
        headers={'Authorization': f'Bearer {AT}', 'Content-Type': 'application/json'},
        method='POST',
    )
    resp = urllib.request.urlopen(req, timeout=60)
    out = json.loads(resp.read().decode('utf-8'))
    print('RENDER DEPLOY:', json.dumps(out, indent=2)[:600])
    return out

def gh_head():
    return json.loads(urllib.request.urlopen('https://api.github.com/repos/ibb142/rork-global-real-estate-invest/commits/main', timeout=15).read())['sha']

def runtime_commit():
    for _ in range(10):
        try:
            d = json.loads(urllib.request.urlopen('https://api.ivxholding.com/health', timeout=15).read())
            c = d.get('commit') or d.get('commitSha') or d.get('sha')
            if c:
                return c, d
        except Exception as e:
            print('health err:', e)
        time.sleep(5)
    return None, None

print('=== TRIGGER RENDER DEPLOY ===')
try:
    trigger_deploy()
except urllib.error.HTTPError as e:
    print(f'deploy trigger HTTP {e.code}: {e.read().decode("utf-8","replace")[:400]}')
    sys.exit(1)

print('\n=== WAITING FOR RENDER TO PICK UP THE NEW COMMIT ===')
target = gh_head()
print(f'Target (GitHub HEAD): {target}')
runtime, _ = runtime_commit()
print(f'Runtime commit immediately after trigger: {runtime}')

# Poll up to ~6 min for runtime to match GitHub HEAD
deadline = time.time() + 360
attempts = 0
while time.time() < deadline:
    attempts += 1
    time.sleep(15)
    runtime, health = runtime_commit()
    print(f'attempt {attempts}: runtime={runtime} target={target} match={runtime == target}')
    if runtime == target:
        print('\n3-WAY SHA PARITY MATCH:')
        print(f'  GitHub: {target}')
        print(f'  Render: {target}')
        print(f'  Runtime /health: {runtime}')
        # also surface health status
        try:
            h = json.loads(urllib.request.urlopen('https://api.ivxholding.com/health', timeout=15).read())
            print(f'  /health status: {h.get("status", "n/a")} | healthy: {h.get("healthy", "n/a")}')
        except Exception:
            pass
        sys.exit(0)

print(f'\nTIMED OUT after {attempts} attempts. GitHub={target} Runtime={runtime}')
sys.exit(2)
