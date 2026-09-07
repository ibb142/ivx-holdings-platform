import copy
import unittest
from landing112_kickoff import (SHA, GateError, select_existing, select_new,
                               validate_live, validate_priority, validate_registry)


def registry():
    return {"ok": True, "totalAgents": 112,
            "agents": [{"agentId": f"agent-{n}", "agentNumber": n} for n in range(1, 113)]}


class LauncherSafetyTests(unittest.TestCase):
    def test_exact_registry(self):
        self.assertEqual(len(validate_registry(registry())), 112)

    def test_missing_agent_rejected(self):
        value = registry(); value["agents"].pop()
        with self.assertRaises(GateError): validate_registry(value)

    def test_duplicate_id_rejected(self):
        value = registry(); value["agents"][1]["agentId"] = "agent-1"
        with self.assertRaises(GateError): validate_registry(value)

    def test_duplicate_number_rejected(self):
        value = registry(); value["agents"][1]["agentNumber"] = 1
        with self.assertRaises(GateError): validate_registry(value)

    def test_boolean_number_rejected(self):
        value = registry(); value["agents"][0]["agentNumber"] = True
        with self.assertRaises(GateError): validate_registry(value)

    def test_out_of_range_rejected(self):
        value = registry(); value["agents"][0]["agentNumber"] = 113
        with self.assertRaises(GateError): validate_registry(value)

    def test_holds_preserved_not_mutated(self):
        value = registry(); value["agents"][0].update(paused=True, disabled=True)
        original = copy.deepcopy(value)
        rows = validate_registry(value)
        self.assertEqual(value, original)
        self.assertTrue(rows[0]["paused"] and rows[0]["disabled"])

    def test_healthy_exact_sha(self):
        validate_live({"ok": True, "commit": SHA}, {"ok": True, "commit": SHA})

    def test_sha_drift_rejected(self):
        with self.assertRaises(GateError):
            validate_live({"ok": True, "commit": SHA}, {"ok": True, "commit": "old"})

    def test_missing_health_rejected(self):
        with self.assertRaises(GateError): validate_live({}, {"ok": True, "commit": SHA})

    def test_wrong_mission_rejected(self):
        with self.assertRaises(GateError):
            validate_priority({"active": True, "priority": "P0-OWNER", "mission": "app"})

    def test_string_true_rejected(self):
        with self.assertRaises(GateError):
            validate_priority({"active": "true", "priority": "P0-OWNER", "mission": "landing"})

    def test_owner_landing_priority(self):
        validate_priority({"active": True, "priority": "P0-OWNER", "mission": "landing"})

    def test_existing_run_attached(self):
        row = {"id": 1, "status": "in_progress", "head_sha": SHA}
        self.assertEqual(select_existing([row]), row)

    def test_existing_old_sha_not_cancelled_or_replaced(self):
        with self.assertRaises(GateError):
            select_existing([{"id": 1, "status": "queued", "head_sha": "old"}])

    def test_ambiguous_active_rejected(self):
        with self.assertRaises(GateError):
            select_existing([{"id": n, "status": "queued", "head_sha": SHA} for n in (1, 2)])

    def test_completed_run_does_not_count_as_active(self):
        self.assertIsNone(select_existing([{"id": 1, "status": "completed", "head_sha": SHA}]))

    def test_old_run_not_reused_as_new(self):
        row = {"id": 1, "head_sha": SHA, "head_branch": "main", "event": "workflow_dispatch",
               "created_at": "2026-09-07T00:00:00Z"}
        self.assertIsNone(select_new([row], 9999999999))

    def test_new_run_found_without_claiming_agent_completion(self):
        row = {"id": 1, "head_sha": SHA, "head_branch": "main", "event": "workflow_dispatch",
               "created_at": "2026-09-07T00:00:00Z", "status": "queued"}
        self.assertEqual(select_new([row], 0), row)
        self.assertNotIn("agentsSucceeded", row)

    def test_ambiguous_new_run_rejected(self):
        row = {"head_sha": SHA, "head_branch": "main", "event": "workflow_dispatch",
               "created_at": "2026-09-07T00:00:00Z"}
        with self.assertRaises(GateError): select_new([dict(row, id=1), dict(row, id=2)], 0)



class LaunchIntegrationTests(unittest.TestCase):
    def exercise(self, scenario):
        import base64
        import json
        from unittest.mock import patch
        from landing112_kickoff import WORKFLOW_BLOB, run
        calls = []
        main_reads = 0
        active = {"id": 71, "head_sha": SHA, "head_branch": "main", "status": "queued"}
        def fake_request(url, token=None, body=None):
            nonlocal main_reads
            calls.append((url, body))
            if url.endswith("git/ref/heads/main"):
                main_reads += 1
                commit = "changed" if scenario == "main_drift" and main_reads == 2 else SHA
                return 200, {"object": {"sha": commit}}
            if "contents/.github/workflows/" in url:
                return 200, {"sha": "changed" if scenario == "workflow_drift" else WORKFLOW_BLOB}
            if "contents/qa/owner-priority-state" in url:
                value = {"active": True, "mission": "landing", "priority": "P0-OWNER"}
                return 200, {"content": base64.b64encode(json.dumps(value).encode()).decode()}
            if url.endswith("/health") or url.endswith("/version"):
                self.assertIsNone(token)
                return 200, {"ok": True, "commit": SHA}
            if url.endswith("/api/ivx/agents"):
                self.assertIsNone(token)
                return 200, registry()
            if "&status=" in url:
                rows = [active] if scenario == "attach" and url.endswith("status=queued") else []
                return 200, {"total_count": len(rows), "workflow_runs": rows}
            if url.endswith("/dispatches"):
                self.assertEqual(body, {"ref": "main"})
                if scenario == "lost_response": raise GateError("NETWORK_OUTCOME_UNKNOWN")
                return 204, None
            if "event=workflow_dispatch" in url:
                row = dict(active, event="workflow_dispatch", created_at="2026-09-07T00:00:00Z")
                return 200, {"workflow_runs": [row]}
            self.fail("Unexpected request: " + url)
        proof = {}
        with patch.dict("os.environ", {"GH_TOKEN": "fixture-only", "GITHUB_REPOSITORY": "ibb142/ivx-holdings-platform"}), patch("landing112_kickoff.request_json", fake_request), patch("landing112_kickoff.time.time", return_value=100):
            try:
                run(proof)
            except GateError as exc:
                proof["blocker"] = str(exc)
        return proof, [c for c in calls if c[1] is not None]

    def test_happy_path_single_dispatch(self):
        proof, posts = self.exercise("normal")
        self.assertEqual(len(posts), 1)
        self.assertEqual(proof["state"], "FLEET_RUN_CREATED")
        self.assertEqual(proof["fleetRun"]["id"], 71)

    def test_lost_post_response_reconciled_without_retry(self):
        proof, posts = self.exercise("lost_response")
        self.assertEqual(len(posts), 1)
        self.assertEqual(proof["state"], "FLEET_RUN_CREATED")

    def test_attach_does_not_dispatch(self):
        proof, posts = self.exercise("attach")
        self.assertEqual(posts, [])
        self.assertEqual(proof["state"], "ATTACHED_EXISTING_RUN")

    def test_changed_workflow_never_dispatches(self):
        proof, posts = self.exercise("workflow_drift")
        self.assertEqual(posts, [])
        self.assertEqual(proof["blocker"], "WORKFLOW_CHANGED_REVIEW_REQUIRED")

    def test_main_move_never_dispatches(self):
        proof, posts = self.exercise("main_drift")
        self.assertEqual(posts, [])
        self.assertEqual(proof["blocker"], "MAIN_MOVED_BEFORE_DISPATCH")


if __name__ == "__main__": unittest.main()
