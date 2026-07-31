#!/usr/bin/env python3
"""
IVX IA 25x Acceptance Test — runs the 5-turn acceptance conversation 25 times.
"""
import json, sys, time, urllib.request, urllib.error

TOKEN = open('/tmp/owner_token.txt').read().strip()
API = "https://api.ivxholding.com"

TURNS_ES = [
    "¿Cuántas propiedades tenemos?",
    "La quiero ahora y yo te autorizo.",
    "¿Cuántas están activas?",
    "Muéstrame las últimas cinco.",
    "¿Dónde nos quedamos?",
]

TURNS_EN = [
    "How many properties do we have?",
    "I want it now and I authorize you.",
    "How many are active?",
    "Show me the latest five.",
    "Where were we?",
]

UNRELATED = [
    "What is 2+2?",
    "¿Qué hora es?",
    "Explain microservices architecture.",
    "What is the capital of France?",
    "¿Cuál es tu nombre?",
]

def send_message(prompt):
    body = json.dumps({"message": prompt}).encode('utf-8')
    req = urllib.request.Request(
        f"{API}/api/ivx/owner-ai",
        data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {TOKEN}"},
        method="POST",
    )
    try:
        resp = urllib.request.urlopen(req, timeout=45)
        return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return {"ok": False, "error": f"HTTP {e.code}: {e.read().decode()[:300]}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}

def validate_turn(turn_num, response):
    errors = []
    # API returns status: "ok", not ok: true at top level
    status = response.get("status", "")
    if status != "ok":
        return [f"Turn {turn_num}: response.status is '{status}': {response.get('error','?')[:200]}"]
    answer = response.get("answer", "") or ""
    if not answer:
        return [f"Turn {turn_num}: empty answer"]
    provider = response.get("provider", "")
    model = response.get("model", "")
    went_to_llm = "chatgpt" in provider.lower() or "gpt-4o" in model.lower()

    if turn_num == 1:
        if "autoriz" in answer.lower() or "authorize" in answer.lower() or "permission" in answer.lower():
            pass
        elif "3 propiedades" in answer or "3 properties" in answer or "tenemos 3" in answer.lower():
            pass
        elif went_to_llm:
            errors.append(f"Turn 1: went to LLM. provider={provider} model={model}")
        else:
            errors.append(f"Turn 1: unexpected. Answer: {answer[:200]}")
    elif turn_num == 2:
        if "3 propiedades" in answer or "3 properties" in answer:
            pass
        elif "cancel" in answer.lower():
            errors.append("Turn 2: cancelled instead of approved")
        elif went_to_llm:
            errors.append(f"Turn 2: LLM (context lost!). provider={provider}")
        else:
            errors.append(f"Turn 2: unexpected. Answer: {answer[:200]}")
    elif turn_num == 3:
        if "activas" in answer.lower() or "active" in answer.lower():
            pass
        elif went_to_llm:
            errors.append(f"Turn 3: LLM (context lost!). provider={provider}")
        else:
            errors.append(f"Turn 3: unexpected. Answer: {answer[:200]}")
    elif turn_num == 4:
        if any(kw in answer.lower() for kw in ["propiedad", "property", "deal", "jv_deals", "one stop", "perez", "rosario"]):
            pass
        elif went_to_llm:
            errors.append(f"Turn 4: LLM (context lost!). provider={provider}")
        else:
            errors.append(f"Turn 4: unexpected. Answer: {answer[:200]}")
    elif turn_num == 5:
        if any(kw in answer.lower() for kw in ["trabajando", "working", "últimas", "latest", "propiedad", "property"]):
            pass
        else:
            errors.append(f"Turn 5: didn't recall last action. Answer: {answer[:200]}")
    return errors

def run_conversation(run_num, lang='es'):
    turns = TURNS_ES if lang == 'es' else TURNS_EN
    all_pass = True
    results = []
    for turn_num, prompt in enumerate(turns, 1):
        time.sleep(2)
        resp = send_message(prompt)
        errors = validate_turn(turn_num, resp)
        r = {"run": run_num, "turn": turn_num, "prompt": prompt, "pass": len(errors) == 0, "errors": errors,
             "provider": resp.get("provider", "?"), "model": resp.get("model", "?"),
             "answer_preview": (resp.get("answer", "") or "")[:150]}
        results.append(r)
        if errors:
            all_pass = False
        status = "PASS" if not errors else f"FAIL: {'; '.join(errors)[:120]}"
        print(f"  Run {run_num:2d} Turn {turn_num}: {status}", flush=True)
    return all_pass, results

def main():
    print("=" * 70)
    print("IVX IA 25x Acceptance Test")
    print("=" * 70)
    try:
        resp = urllib.request.urlopen(f"{API}/health", timeout=10)
        health = json.loads(resp.read())
        print(f"\nProduction: status={health.get('status')}, commit={health.get('commit','?')[:12]}, bootTime={health.get('bootTime','?')}")
    except:
        print("\nWARNING: Could not reach /health")

    all_results = []
    pass_count = 0
    fail_count = 0

    print(f"\n--- Running 25 acceptance conversations (Spanish) ---\n")
    for run_num in range(1, 26):
        print(f"\nRun {run_num}/25:", flush=True)
        all_pass, results = run_conversation(run_num, lang='es')
        all_results.extend(results)
        if all_pass:
            pass_count += 1
            print(f"  → Run {run_num}: ALL 5 TURNS PASS ✅", flush=True)
        else:
            fail_count += 1
            print(f"  → Run {run_num}: FAILED ❌", flush=True)

    # Context persistence after unrelated questions
    print(f"\n--- Context persistence after unrelated questions ---\n", flush=True)
    time.sleep(2)
    r1 = send_message("¿Cuántas propiedades tenemos?")
    print(f"  Turn 1 (property count): {'PASS' if r1.get('ok') else 'FAIL'}", flush=True)
    for q in UNRELATED:
        time.sleep(2)
        r = send_message(q)
        print(f"  Unrelated: '{q[:30]}...' → {'ok' if r.get('ok') else 'FAIL'}", flush=True)
    time.sleep(2)
    r_followup = send_message("¿Cuántas están activas?")
    followup_errors = validate_turn(3, r_followup)
    print(f"  Follow-up (active count after unrelated): {'PASS ✅' if not followup_errors else 'FAIL ❌: ' + '; '.join(followup_errors)[:120]}", flush=True)

    # English conversation
    print(f"\n--- English acceptance conversation ---\n", flush=True)
    en_pass, en_results = run_conversation(26, lang='en')
    all_results.extend(en_results)
    if en_pass:
        pass_count += 1
        print(f"  → English run: ALL 5 TURNS PASS ✅", flush=True)
    else:
        fail_count += 1
        print(f"  → English run: FAILED ❌", flush=True)

    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    total_turns = len(all_results)
    turn_passes = sum(1 for r in all_results if r["pass"])
    turn_fails = sum(1 for r in all_results if not r["pass"])
    print(f"\nConversations: {pass_count} pass, {fail_count} fail out of {pass_count + fail_count}")
    print(f"Individual turns: {turn_passes} pass, {turn_fails} fail out of {total_turns}")
    print(f"Turn pass rate: {turn_passes/total_turns*100:.1f}%")
    if turn_fails > 0:
        print(f"\n--- FAILURES ---")
        for r in all_results:
            if not r["pass"]:
                print(f"  Run {r['run']} Turn {r['turn']}: {r['errors'][0][:150]}")
                print(f"    provider={r['provider']}, model={r['model']}")
                print(f"    answer: {r['answer_preview']}")
    with open('/tmp/ivx_acceptance_results.json', 'w') as f:
        json.dump({"totalConversations": pass_count + fail_count, "conversationsPass": pass_count,
                   "conversationsFail": fail_count, "totalTurns": total_turns,
                   "turnPasses": turn_passes, "turnFails": turn_fails,
                   "turnPassRate": f"{turn_passes/total_turns*100:.1f}%",
                   "results": all_results}, f, indent=2)
    print(f"\nResults saved to /tmp/ivx_acceptance_results.json")
    if turn_fails == 0:
        print(f"\nVERDICT: 100% PASS — All {total_turns} turns across {pass_count} conversations passed.")
        return 0
    else:
        print(f"\nVERDICT: {turn_fails} failures found — context layer is NOT complete.")
        return 1

if __name__ == "__main__":
    sys.exit(main())
