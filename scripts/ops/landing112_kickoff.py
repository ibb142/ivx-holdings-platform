"""Owner-authorized one-shot launcher. Dispatch acceptance is NOT agent completion."""
import base64
import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO = "ibb142/ivx-holdings-platform"
SHA = "fe73e97e21eeacd279038a5a00f26da613b2a6c5"
WORKFLOW = "landing-112-3h-enterprise-human-qa.yml"
WORKFLOW_BLOB = "e1a208305e402644247c52a1d9e69332a0fcbbca"
ACTIVE = {"queued", "in_progress", "waiting", "pending", "requested"}


class GateError(Exception):
    pass


def require(condition, code):
    if not condition:
        raise GateError(code)


def validate_priority(value):
    require(isinstance(value, dict), "OWNER_PRIORITY_INVALID")
    require(value.get("active") is True and value.get("mission") == "landing"
            and value.get("priority") == "P0-OWNER", "OWNER_LANDING_PRIORITY_REQUIRED")


def validate_live(health, version):
    for name, value in (("HEALTH", health), ("VERSION", version)):
        require(isinstance(value, dict) and value.get("ok") is True, name + "_NOT_HEALTHY")
        require(value.get("commit") == SHA, name + "_EXACT_SHA_MISMATCH")


def validate_registry(value):
    require(isinstance(value, dict) and value.get("ok") is True, "REGISTRY_NOT_OK")
    agents = value.get("agents")
    require(value.get("totalAgents") == 112 and isinstance(agents, list)
            and len(agents) == 112, "REGISTRY_COUNT_MISMATCH")
    require(all(isinstance(a, dict) and type(a.get("agentNumber")) is int
                and isinstance(a.get("agentId"), str) and a["agentId"].strip()
                for a in agents), "REGISTRY_INVALID_IDENTITY")
    require({a["agentNumber"] for a in agents} == set(range(1, 113)), "REGISTRY_NUMBER_MISMATCH")
    require(len({a["agentId"] for a in agents}) == 112, "REGISTRY_DUPLICATE_ID")
    return [{k: a.get(k) for k in ("agentId", "agentNumber", "availability", "paused", "disabled")}
            for a in sorted(agents, key=lambda a: a["agentNumber"])]


def select_existing(runs):
    active = {r["id"]: r for r in runs if r.get("status") in ACTIVE}
    require(not any(r.get("head_sha") != SHA for r in active.values()), "OTHER_SHA_FLEET_ACTIVE")
    require(len(active) <= 1, "MULTIPLE_ACTIVE_FLEETS")
    return next(iter(active.values()), None)


def select_new(runs, since):
    found = [r for r in runs if r.get("head_sha") == SHA and r.get("head_branch") == "main"
             and r.get("event") == "workflow_dispatch"
             and datetime.fromisoformat(r["created_at"].replace("Z", "+00:00")).timestamp() >= since]
    require(len(found) <= 1, "AMBIGUOUS_NEW_FLEET")
    return found[0] if found else None


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request_json(url, token=None, body=None):
    headers = {"Accept": "application/json", "User-Agent": "IVX-owner-landing112-kickoff"}
    if token:
        require(url.startswith("https://api.github.com/repos/" + REPO + "/"), "AUTH_DESTINATION_DENIED")
        headers["Authorization"] = "Bearer " + token
        headers["X-GitHub-Api-Version"] = "2022-11-28"
    payload = None if body is None else json.dumps(body).encode()
    if payload is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=payload, headers=headers)
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=25) as response:
            raw = response.read(1024 * 1024 + 1)
            require(len(raw) <= 1024 * 1024, "RESPONSE_TOO_LARGE")
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        raise GateError("HTTP_" + str(exc.code)) from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise GateError("NETWORK_OUTCOME_UNKNOWN" if body is not None else "NETWORK_READ_FAILED") from None
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise GateError("INVALID_JSON") from None


def run(proof):
    token = os.environ.get("GH_TOKEN", "")
    require(os.environ.get("GITHUB_REPOSITORY") == REPO and token, "REPOSITORY_AUTH_REQUIRED")
    prefix = "https://api.github.com/repos/" + REPO + "/"

    def gh(path, body=None):
        return request_json(prefix + path, token, body)

    _, main = gh("git/ref/heads/main")
    require(main["object"]["sha"] == SHA, "MAIN_CHANGED_REVIEW_REQUIRED")
    _, definition = gh("contents/.github/workflows/" + WORKFLOW + "?ref=" + SHA)
    require(definition.get("sha") == WORKFLOW_BLOB, "WORKFLOW_CHANGED_REVIEW_REQUIRED")
    _, owner_file = gh("contents/qa/owner-priority-state.json?ref=" + SHA)
    priority = json.loads(base64.b64decode(owner_file["content"], validate=False))
    validate_priority(priority)
    proof["ownerPriority"] = {"active": True, "mission": "landing", "priority": "P0-OWNER"}
    _, health = request_json("https://api.ivxholding.com/health")
    _, version = request_json("https://api.ivxholding.com/version")
    validate_live(health, version)
    proof["healthSha"] = health["commit"]
    proof["versionSha"] = version["commit"]
    _, registry = request_json("https://api.ivxholding.com/api/ivx/agents")
    proof["registry"] = validate_registry(registry)
    proof["registeredAgents"] = len(proof["registry"])
    wf_path = "actions/workflows/" + WORKFLOW + "/runs"
    active_runs = []
    for status in sorted(ACTIVE):
        _, page = gh(wf_path + "?per_page=100&status=" + status)
        require(page.get("total_count", 0) <= 100, "ACTIVE_RUN_PAGINATION_REQUIRED")
        active_runs.extend(page["workflow_runs"])
    existing = select_existing(active_runs)
    if existing:
        proof["state"] = "ATTACHED_EXISTING_RUN"
        proof["fleetRun"] = {k: existing.get(k) for k in ("id", "status", "head_sha", "html_url")}
        return
    _, main = gh("git/ref/heads/main")
    require(main["object"]["sha"] == SHA, "MAIN_MOVED_BEFORE_DISPATCH")
    since = int(time.time())
    proof["dispatchRequestedAt"] = datetime.fromtimestamp(since, timezone.utc).isoformat()
    # Never blindly retry this POST. A lost response may still have launched the run.
    try:
        status, _ = gh("actions/workflows/" + WORKFLOW + "/dispatches", {"ref": "main"})
        require(status == 204, "UNEXPECTED_DISPATCH_STATUS")
        proof["dispatchHttp"] = status
        proof["state"] = "DISPATCH_ACCEPTED_PENDING_RUN_ID"
    except GateError as exc:
        if str(exc) != "NETWORK_OUTCOME_UNKNOWN":
            raise
        proof["state"] = "DISPATCH_OUTCOME_UNKNOWN"
    for attempt in range(12):
        _, page = gh(wf_path + "?branch=main&event=workflow_dispatch&per_page=20")
        new = select_new(page["workflow_runs"], since)
        if new:
            proof["state"] = "FLEET_RUN_CREATED"
            proof["fleetRun"] = {k: new.get(k) for k in ("id", "status", "head_sha", "html_url")}
            return
        if attempt < 11:
            time.sleep(5)
    raise GateError("DISPATCH_NOT_VERIFIED_DO_NOT_RETRY_BLINDLY")


def main():
    proof = {"state": "NOT_DISPATCHED", "expectedProductionSha": SHA,
             "reviewedWorkflowBlob": WORKFLOW_BLOB, "targetWorkflow": WORKFLOW,
             "launcherRunId": os.environ.get("GITHUB_RUN_ID"), "agentsStarted": None,
             "agentsFinished": None, "agentsSucceeded": None, "agentsFailed": None,
             "sourceReferenceCount": None, "toolResultIdCount": None,
             "landingCompletionVerified": False, "ownerHoldsOverridden": False,
             "note": "Launcher evidence only. Target run artifacts are required for per-agent and release proof."}
    exit_code = 0
    try:
        run(proof)
    except GateError as exc:
        proof["blocker"] = str(exc)
        exit_code = 1
    except Exception:
        proof["blocker"] = "UNEXPECTED_ERROR_FAIL_CLOSED"
        exit_code = 1
    finally:
        proof["observedAt"] = datetime.now(timezone.utc).isoformat()
        output = Path("evidence/landing112-kickoff")
        output.mkdir(parents=True, exist_ok=True)
        (output / "result.json").write_text(json.dumps(proof, indent=2) + "\n")
        print(json.dumps({k: v for k, v in proof.items() if k != "registry"}, indent=2))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
