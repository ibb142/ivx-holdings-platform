"""Match each planned Android route to its actual Maestro JUnit outcome."""
import json
import sys
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path


def route_results(manifest, xml_text):
    cases = list(ET.fromstring(xml_text).iter("testcase"))
    counts = Counter(case.get("name") for case in cases)
    by_name = {case.get("name"): case for case in cases}
    expected = Counter(item["name"] for item in manifest)
    if any(count != 1 for count in expected.values()):
        raise ValueError("Route manifest contains duplicate flow names")
    if set(counts) - set(expected):
        raise ValueError("JUnit contains unplanned route results")
    results = []
    for item in manifest:
        case = by_name.get(item["name"])
        ok = (case is not None and counts[item["name"]] == 1
              and case.get("status") == "SUCCESS"
              and not any(case.find(tag) is not None for tag in ("failure", "error", "skipped")))
        results.append({**item, "passed": ok, "automated": True,
                        "status": case.get("status", "UNKNOWN") if case is not None else "NOT_RUN",
                        "durationSeconds": case.get("time") if case is not None else None,
                        "startedAt": case.get("timestamp") if case is not None else None})
    return results


if __name__ == "__main__":
    manifest = [json.loads(line) for line in Path(sys.argv[1]).read_text().splitlines() if line.strip()]
    results = route_results(manifest, Path(sys.argv[2]).read_text())
    Path(sys.argv[3]).write_text(json.dumps(results, indent=2) + "\n")
    print(json.dumps({"planned": len(results), "passed": sum(item["passed"] for item in results)}))
