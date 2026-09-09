import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('proof', Path(__file__).with_name('ivx-route-suite-proof.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RouteCertificateTests(unittest.TestCase):
    def fixture(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        (root / 'artifacts').mkdir()
        rows = [dict(name=f'route-{i}', route=f'/{i}', screenshot=f'route-{i}') for i in range(101)]
        (root / 'manifest.jsonl').write_text('\n'.join(json.dumps(row) for row in rows))
        for row in rows:
            (root / 'artifacts' / (row['screenshot'] + '.png')).write_bytes(b'fixture')
        cases = [f'<testcase name="route-{i}" status="SUCCESS" />' for i in range(101)]
        return root, cases

    def check(self, root, cases, code=0, alive=True):
        (root / 'suite.xml').write_text('<testsuites><testsuite>' + ''.join(cases) + '</testsuite></testsuites>')
        return module.certify(root, 'a' * 40, code, alive)['passed']

    def test_complete_report_passes(self):
        root, cases = self.fixture()
        self.assertTrue(self.check(root, cases))

    def test_complete_batched_reports_pass(self):
        root, cases = self.fixture()
        suites = root / 'suites'
        suites.mkdir()
        for index, start in enumerate(range(0, len(cases), 20), 1):
            report = suites / f'batch-{index:03d}.xml'
            report.write_text('<testsuites><testsuite>' + ''.join(cases[start:start + 20]) + '</testsuite></testsuites>')
        self.assertTrue(module.certify(root, 'a' * 40, 0, True)['passed'])

    def test_batched_reports_still_fail_closed(self):
        root, cases = self.fixture()
        suites = root / 'suites'
        suites.mkdir()
        (suites / 'batch-001.xml').write_text(
            '<testsuites><testsuite>' + ''.join(cases[:100]) + '</testsuite></testsuites>')
        self.assertFalse(module.certify(root, 'a' * 40, 0, True)['passed'])

    def test_missing_duplicate_failed_or_skipped_route_fails(self):
        for replacement in (None, '<testcase name="route-0" status="SUCCESS" />',
                            '<testcase name="route-100" status="FAILED"><failure /></testcase>',
                            '<testcase name="route-100" status="SUCCESS"><skipped /></testcase>'):
            with self.subTest(replacement=replacement):
                root, cases = self.fixture()
                cases = cases[:-1] + ([replacement] if replacement else [])
                self.assertFalse(self.check(root, cases))

    def test_process_loss_timeout_or_missing_screenshot_fails(self):
        root, cases = self.fixture()
        self.assertFalse(self.check(root, cases, alive=False))
        self.assertFalse(self.check(root, cases, code=124))
        (root / 'artifacts' / 'route-7.png').unlink()
        self.assertFalse(self.check(root, cases))


if __name__ == '__main__':
    unittest.main()
