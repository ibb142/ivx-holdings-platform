#!/usr/bin/env bash
# Commit the enterprise stability portfolio provider fix via owner-gated GitHub API.
set -e
AT=$(cat /tmp/owner_at)
API="https://api.ivxholding.com/api/ivx/developer-deploy/action"

commit_file() {
  local path="$1"
  local message="$2"
  local raw
  raw=$(python3 -c "
import gzip, base64, sys
with open('$path','rb') as f: data=f.read()
gz=gzip.compress(data,9)
print(base64.b64encode(gz).decode())
")
  local size
  size=$(wc -c < "$path")
  echo "  committing $path ($size bytes, gzip-base64)"
  local payload
  payload=$(python3 -c "
import json,sys
b64='''$raw'''
print(json.dumps({
  'action':'github_commit_file',
  'input':{
    'path':'$path',
    'content':b64,
    'contentEncoding':'gzip-base64',
    'message':'''$(python3 -c "import json;print(json.dumps(\"$message\"))")'''
  },
  'confirm':True,
  'confirmText':'CONFIRM_IVX_GITHUB_WRITE'
}))
")
  local resp
  resp=$(curl -s -X POST "$API" -H "Authorization: Bearer $AT" -H "Content-Type: application/json" -d "$payload" --max-time 60)
  echo "    -> $(echo "$resp" | python3 -c "import json,sys
try:
  d=json.load(sys.stdin)
  print('ok=',d.get('ok'),'sha=',d.get('commit',{}).get('sha','')[:12],'msg=',(d.get('commit',{}).get('message','') or '')[:60])
except Exception as e:
  print('PARSE-ERR',str(e)[:80],sys.stdin.read()[:120])")"
}

echo "=== Enterprise Stability Portfolio Fix — committing 5 files ==="
commit_file "expo/app/_layout.tsx" "enterprise: mount WalletProvider+EarnProvider in root (portfolio crash root cause)"
commit_file "expo/app/wallet.tsx" "enterprise: safe destructure useEarn() with fallback in WalletScreen"
commit_file "expo/app/ipx-earn.tsx" "enterprise: safe destructure useEarn() with fallback in IPXEarnScreen"
commit_file "expo/app.config.ts" "v1.4.16(48) buildMarker ENTERPRISE_STABILITY_PORTFOLIO_PROVIDER_FIX"
commit_file "expo/android/app/build.gradle" "v1.4.16(48) version bump"
echo "=== done ==="
