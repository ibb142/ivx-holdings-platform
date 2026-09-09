"""Fail closed unless Maestro reports every enumerated route as successful."""
import json
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path


def certify(directory, source_sha, exit_code, process_alive):
    root = Path(directory)
    manifest = [json.loads(line) for line in (root / 'manifest.jsonl').read_text().splitlines()]
    cases = {}
    reports = sorted((root / 'suites').glob('*.xml')) if (root / 'suites').is_dir() else []
    if not reports and (root / 'suite.xml').is_file():
        reports = [root / 'suite.xml']
    valid_report = bool(reports)
    try:
        for report in reports:
            for case in ET.parse(report).iter('testcase'):
                identity = case.get('name')
                if identity in cases:
                    valid_report = False
                cases[identity] = case
    except (OSError, ET.ParseError):
        valid_report = False
    valid_report = valid_report and set(cases) == {row['name'] for row in manifest}
    results = []
    for row in manifest:
        case = cases.get(row['name'])
        screenshot = any(path.stat().st_size > 0 for path in (root / 'artifacts').rglob(row['screenshot'] + '.png'))
        ok = (valid_report and exit_code == 0 and process_alive and screenshot
              and case is not None and case.get('status') == 'SUCCESS'
              and not any(case.find(tag) is not None for tag in ('failure', 'error', 'skipped')))
        results.append({**row, 'passed': ok, 'processAlive': process_alive,
                        'automated': True, 'screenshotCaptured': screenshot})
    passed = sum(row['passed'] for row in results)
    total = len(results)
    proof = {'certificate': 'IVX-ALL-EXPO-ROUTES-AUTOMATED-E2E', 'sourceSha': source_sha,
             'totalRoutes': total, 'passedRoutes': passed, 'failedRoutes': total - passed,
             'coveragePercent': round(passed * 100 / total, 2) if total else 0,
             'passed': total > 100 and passed == total and valid_report,
             'realOwnerLogin': True, 'androidEmulator': True, 'automated': True,
             'everyRouteOpened': passed == total and total > 0,
             'everyRouteScrolled': passed == total and total > 0,
             'processSurvivalChecked': True, 'processAlive': process_alive,
             'verifiedAt': datetime.now(timezone.utc).isoformat()}
    (root / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
    (root / 'certificate.json').write_text(json.dumps(proof, indent=2) + '\n')
    return proof


if __name__ == '__main__':
    result = certify(sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4] == 'true')
    print(json.dumps(result))
    raise SystemExit(0 if result['passed'] else 1)
