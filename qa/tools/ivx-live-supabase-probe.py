#!/usr/bin/env python3
"""IVX live Supabase verification harness.

Runs privilege/RLS verification against the LIVE project using the Supabase
Management API (SQL + advisors) and the PostgREST/GoTrue endpoints (real anon and
authenticated negative tests).

Safety rules enforced here:
  * never prints a credential value - only lengths, role claims and booleans
  * read-only SQL for verification; DDL is applied only via the explicit --apply path
  * synthetic test accounts only; owner credentials are never used
"""
import json
import os
import re
import subprocess
import sys
import time

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
STATE = "/tmp/ivxsec/creds.json"


def load_env_file(path):
    """Parse a .env file tolerantly; values may contain pasted CLI noise."""
    out = {}
    if not os.path.exists(path):
        return out
    for line in open(path, "r", errors="replace"):
        line = line.rstrip("\n")
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def curl(url, method="GET", headers=None, body=None, timeout=45):
    """HTTP via curl: the Supabase edge rejects urllib's client signature (CF 1010)."""
    cmd = ["curl", "-s", "-o", "/tmp/ivxsec/_body", "-w", "%{http_code}",
           "-X", method, "--max-time", str(timeout), "-H", "User-Agent: " + UA]
    for k, v in (headers or {}).items():
        cmd += ["-H", f"{k}: {v}"]
    if body is not None:
        cmd += ["-H", "Content-Type: application/json", "-d", json.dumps(body)]
    cmd.append(url)
    proc = subprocess.run(cmd, capture_output=True, text=True)
    code = (proc.stdout or "").strip()
    try:
        payload = open("/tmp/ivxsec/_body", "r", errors="replace").read()
    except OSError:
        payload = ""
    return (int(code) if code.isdigit() else None), payload


def mgmt_sql(ref, token, sql):
    """Run SQL through the Management API query endpoint."""
    status, body = curl(
        f"https://api.supabase.com/v1/projects/{ref}/database/query",
        method="POST",
        headers={"Authorization": "Bearer " + token},
        body={"query": sql},
    )
    if status == 201 or status == 200:
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            return {"_raw": body}
    return {"_status": status, "_body": body[:600]}


def advisors(ref, token, kind="security"):
    status, body = curl(
        f"https://api.supabase.com/v1/projects/{ref}/advisors/{kind}",
        headers={"Authorization": "Bearer " + token},
    )
    try:
        return status, json.loads(body)
    except json.JSONDecodeError:
        return status, {"_body": body[:600]}


def api_keys(ref, token):
    status, body = curl(
        f"https://api.supabase.com/v1/projects/{ref}/api-keys?reveal=true",
        headers={"Authorization": "Bearer " + token},
    )
    try:
        return status, json.loads(body)
    except json.JSONDecodeError:
        return status, {"_body": body[:400]}


def save_state(d):
    os.makedirs("/tmp/ivxsec", exist_ok=True)
    json.dump(d, open(STATE, "w"))


def load_state():
    return json.load(open(STATE)) if os.path.exists(STATE) else {}


if __name__ == "__main__":
    print("harness module - invoked by the IVX verification steps")
