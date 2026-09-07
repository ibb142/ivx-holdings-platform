"""Read-only snapshot of one actual landing fleet, not a release certificate."""
import collections
import io
import json
import os
import re
import sys
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

REPO = 'ibb142/ivx-holdings-platform'
RUN = 34117902113
SHA = 'fe73e97e21eeacd279038a5a00f26da613b2a6c5'
PREFIX = 'https://api.github.com/repos/' + REPO + '/'
LIMIT = 4 * 1024 * 1024
BROWSER_STEP = 'Execute assigned live-browser E2E gate'
IA_STEP = 'Execute evidence-backed code audit through assigned IA'

class EvidenceError(Exception):
    pass

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def fetch_bytes(url, auth=False, allow_artifact_redirect=False):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'https' or parsed.username or parsed.password:
        raise EvidenceError('INVALID_READ_DESTINATION')
    headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'IVX-landing112-read-only-observer'}
    if auth:
        if not url.startswith(PREFIX):
            raise EvidenceError('AUTH_DESTINATION_DENIED')
        headers['Authorization'] = 'Bearer ' + os.environ['GH_TOKEN']
        headers['X-GitHub-Api-Version'] = '2022-11-28'
    try:
        with urllib.request.build_opener(NoRedirect()).open(urllib.request.Request(url, headers=headers), timeout=20) as response:
            data = response.read(LIMIT + 1)
            if len(data) > LIMIT:
                raise EvidenceError('RESPONSE_TOO_LARGE')
            return data
    except urllib.error.HTTPError as error:
        if allow_artifact_redirect and error.code in (301, 302, 303, 307, 308):
            target = error.headers.get('Location', '')
            host = urllib.parse.urlsplit(target).hostname or ''
            if not (host.endswith('.blob.core.windows.net') or host.endswith('.actions.githubusercontent.com')):
                raise EvidenceError('ARTIFACT_REDIRECT_DESTINATION_REJECTED') from None
            # Do not forward the GitHub credential to artifact storage.
            return fetch_bytes(target, auth=False, allow_artifact_redirect=False)
        raise EvidenceError('HTTP_' + str(error.code)) from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise EvidenceError('READ_NETWORK_FAILED') from None


def gh(path):
    return json.loads(fetch_bytes(PREFIX + path, auth=True))


def pages(path, key):
    rows = []
    total = None
    for page in range(1, 6):
        separator = '&' if '?' in path else '?'
        data = gh(path + separator + 'per_page=100&page=' + str(page))
        batch = data[key]
        rows.extend(batch)
        total = data.get('total_count', total)
        if len(batch) < 100:
            if total is not None and len(rows) < total:
                raise EvidenceError('PAGINATION_INCOMPLETE')
            return rows
    raise EvidenceError('PAGINATION_LIMIT')


def step_summary(job, name):
    match = next((s for s in job.get('steps', []) if s.get('name') == name), {})
    return {k: match.get(k) for k in ('status', 'conclusion', 'started_at', 'completed_at')}


def started(step):
    return step.get('status') == 'in_progress' or (step.get('status') == 'completed' and step.get('conclusion') != 'skipped')


def row_from_job(job):
    match = re.fullmatch(r'qa-112 \((\d+), (ivx_holdings_\d+)\)', job.get('name', ''))
    if not match:
        return None
    number, agent_id = int(match[1]), match[2]
    if not 1 <= number <= 112 or agent_id != 'ivx_holdings_' + str(number):
        raise EvidenceError('JOB_IDENTITY_INVALID')
    browser = step_summary(job, BROWSER_STEP)
    ia = step_summary(job, IA_STEP)
    return {'agentNumber': number, 'agentId': agent_id, 'jobId': job['id'],
            'jobStatus': job['status'], 'jobConclusion': job.get('conclusion'),
            'jobStartedAt': job.get('started_at'), 'jobCompletedAt': job.get('completed_at'),
            'runnerStarted': bool(job.get('runner_id')),
            'browserStep': browser, 'iaStep': ia, 'browserStarted': started(browser),
            'iaInvocationStepStarted': started(ia), 'sourceReference': None, 'toolResultId': None,
            'verifiedBackendResult': False, 'browserEvidence': None, 'evidenceProblem': None}


def check_agent_record(record, row):
    valid = (record.get('agentNumber') == row['agentNumber']
             and record.get('sourceSha') == SHA and record.get('liveSourceSha') == SHA)
    if not valid:
        raise EvidenceError('AGENT_EVIDENCE_IDENTITY_OR_SHA_MISMATCH')
    source, result = record.get('sourceReference'), record.get('toolResultId')
    row['sourceReference'] = source if isinstance(source, str) and source.strip() else None
    row['toolResultId'] = result if isinstance(result, str) and result.strip() else None
    row['verifiedBackendResult'] = (record.get('passed') is True and record.get('status') == 'completed'
                                    and bool(row['sourceReference']) and bool(row['toolResultId']))
    row['backendReportedStatus'] = record.get('status')
    row['backendPassed'] = record.get('passed')
    row['browserEvidenceSha256'] = record.get('browserEvidenceSha256')


def counts(rows):
    return {'expected': 112, 'jobsCreated': len(rows),
            'runnerStarted': sum(r['runnerStarted'] for r in rows),
            'jobsQueued': sum(r['jobStatus'] == 'queued' for r in rows),
            'jobsRunning': sum(r['jobStatus'] == 'in_progress' for r in rows),
            'jobsFinished': sum(r['jobStatus'] == 'completed' for r in rows),
            'jobsSucceeded': sum(r['jobConclusion'] == 'success' for r in rows),
            'jobsFailed': sum(r['jobConclusion'] == 'failure' for r in rows),
            'jobsCancelled': sum(r['jobConclusion'] == 'cancelled' for r in rows),
            'browserStepsStarted': sum(r['browserStarted'] for r in rows),
            'browserStepsPassed': sum(r['browserStep']['conclusion'] == 'success' for r in rows),
            'browserStepsFailed': sum(r['browserStep']['conclusion'] == 'failure' for r in rows),
            'backendInvocationStepsStarted': sum(r['iaInvocationStepStarted'] for r in rows),
            'backendInvocationStepsSkipped': sum(r['iaStep']['conclusion'] == 'skipped' for r in rows),
            'backendResultsVerified': sum(r['verifiedBackendResult'] for r in rows),
            'sourceReferencePresent': sum(bool(r['sourceReference']) for r in rows),
            'toolResultIdPresent': sum(bool(r['toolResultId']) for r in rows),
            'artifactEvidenceRejected': sum(bool(r['evidenceProblem']) for r in rows)}


class ObserverTests(unittest.TestCase):
    def test_pending_not_started(self): self.assertFalse(started({'status': 'pending'}))
    def test_skipped_not_started(self): self.assertFalse(started({'status': 'completed', 'conclusion': 'skipped'}))
    def test_running_started(self): self.assertTrue(started({'status': 'in_progress'}))
    def test_failed_step_started(self): self.assertTrue(started({'status': 'completed', 'conclusion': 'failure'}))
    def test_wrong_sha_rejected(self):
        with self.assertRaises(EvidenceError): check_agent_record({'agentNumber': 1, 'sourceSha': 'old'}, {'agentNumber': 1})
    def test_ok_alone_not_verified(self):
        row = {'agentNumber': 1}
        check_agent_record({'agentNumber': 1, 'sourceSha': SHA, 'liveSourceSha': SHA, 'passed': True, 'status': 'completed'}, row)
        self.assertFalse(row['verifiedBackendResult'])
    def test_evidenced_record_verified(self):
        row = {'agentNumber': 1}
        check_agent_record({'agentNumber': 1, 'sourceSha': SHA, 'liveSourceSha': SHA, 'passed': True,
                            'status': 'completed', 'sourceReference': 'fixture-source', 'toolResultId': 'fixture-result'}, row)
        self.assertTrue(row['verifiedBackendResult'])
    def test_bad_job_identity_rejected(self):
        with self.assertRaises(EvidenceError): row_from_job({'name': 'qa-112 (2, ivx_holdings_3)'})
    def test_setup_not_backend_work(self):
        row = row_from_job({'id': 1, 'name': 'qa-112 (1, ivx_holdings_1)', 'status': 'in_progress', 'runner_id': 3})
        self.assertTrue(row['runnerStarted'])
        self.assertFalse(row['iaInvocationStepStarted'])


def collect():
    run = gh('actions/runs/' + str(RUN))
    if run.get('head_sha') != SHA or run.get('path') != '.github/workflows/landing-112-3h-enterprise-human-qa.yml':
        raise EvidenceError('FLEET_RUN_IDENTITY_MISMATCH')
    jobs = pages('actions/runs/' + str(RUN) + '/jobs?filter=latest', 'jobs')
    rows = [r for j in jobs if (r := row_from_job(j)) is not None]
    by_number = {r['agentNumber']: r for r in rows}
    if len(rows) != len(by_number):
        raise EvidenceError('DUPLICATE_JOB_AGENT_NUMBER')
    artifacts = pages('actions/runs/' + str(RUN) + '/artifacts', 'artifacts')
    seen = set()
    import hashlib
    for artifact in artifacts:
        match = re.fullmatch('landing-500-agent-(\\d+)-' + str(RUN), artifact['name'])
        if not match:
            continue
        number = int(match[1])
        row = by_number.get(number)
        if row is None:
            continue
        try:
            if number in seen:
                raise EvidenceError('DUPLICATE_AGENT_ARTIFACT')
            seen.add(number)
            raw = fetch_bytes(PREFIX + 'actions/artifacts/' + str(artifact['id']) + '/zip', auth=True, allow_artifact_redirect=True)
            digest = 'sha256:' + hashlib.sha256(raw).hexdigest()
            if artifact.get('digest') != digest:
                raise EvidenceError('ARTIFACT_DIGEST_MISMATCH_OR_MISSING')
            row['artifactId'] = artifact['id']
            row['artifactDigest'] = digest
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                agent_records = 0
                for member in archive.infolist():
                    if member.file_size > LIMIT:
                        raise EvidenceError('ARTIFACT_MEMBER_TOO_LARGE')
                    basename = member.filename.rsplit('/', 1)[-1]
                    expected = 'agent-' + str(number).zfill(3)
                    if basename == expected + '.jsonl':
                        for line in archive.read(member).decode('utf-8').splitlines():
                            if line.strip():
                                agent_records += 1
                                if agent_records != 1:
                                    raise EvidenceError('DUPLICATE_BACKEND_RECORD')
                                check_agent_record(json.loads(line), row)
                    elif basename == expected + '.json':
                        data = json.loads(archive.read(member))
                        row['browserEvidence'] = data
        except Exception as error:
            row['verifiedBackendResult'] = False
            row['evidenceProblem'] = str(error) if isinstance(error, EvidenceError) else 'ARTIFACT_PARSE_OR_READ_FAILED'
    proof = {'observedAt': datetime.now(timezone.utc).isoformat(), 'fleetRunId': RUN,
             'runStatus': run['status'], 'runConclusion': run.get('conclusion'), 'sourceSha': SHA,
             'counts': counts(rows), 'agents': sorted(rows, key=lambda r: r['agentNumber']),
             'controllerJobs': [{k: j.get(k) for k in ('id', 'name', 'status', 'conclusion')} for j in jobs if not j.get('name', '').startswith('qa-112 (')],
             'landingCompletionVerified': False,
             'note': 'Runner/step states are not backend execution results. A verified backend result here validates the workflow record and artifact digest, not full engineering or release quality. Counts are a point-in-time snapshot.'}
    return proof


def main():
    if '--self-test' in sys.argv:
        result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(ObserverTests))
        return 0 if result.wasSuccessful() else 1
    if os.environ.get('GITHUB_REPOSITORY') != REPO or not os.environ.get('GH_TOKEN'):
        raise EvidenceError('REPOSITORY_AUTH_REQUIRED')
    output = Path('evidence/landing112-observed')
    output.mkdir(parents=True, exist_ok=True)
    proof = collect()
    (output / 'snapshot.json').write_text(json.dumps(proof, indent=2) + '\n')
    print(json.dumps({k: v for k, v in proof.items() if k != 'agents'}, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
