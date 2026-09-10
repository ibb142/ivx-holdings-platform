import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("route_results", Path(__file__).parents[1] / "ivx-maestro-route-results.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RouteEvidenceTests(unittest.TestCase):
    def test_matches_results_by_name_instead_of_report_order(self):
        result = module.route_results([{"name": "home"}, {"name": "chat"}],
            '<testsuites><testsuite><testcase name="chat" status="SUCCESS"/><testcase name="home" status="SUCCESS"/></testsuite></testsuites>')
        self.assertEqual([row["name"] for row in result], ["home", "chat"])
        self.assertTrue(all(row["passed"] for row in result))

    def test_missing_and_skipped_flows_cannot_pass(self):
        result = module.route_results([{"name": "home"}, {"name": "chat"}],
            '<testsuite><testcase name="home" status="SUCCESS"><skipped/></testcase></testsuite>')
        self.assertFalse(any(row["passed"] for row in result))
        self.assertEqual(result[1]["status"], "NOT_RUN")

    def test_duplicate_or_failed_results_cannot_pass(self):
        for xml in ['<testcase name="home" status="SUCCESS"><failure>blank</failure></testcase>',
                    '<testcase name="home" status="SUCCESS"/><testcase name="home" status="SUCCESS"/>',
                    '<testcase name="home" status="RUNNING"/>']:
            self.assertFalse(module.route_results([{"name": "home"}], '<testsuite>' + xml + '</testsuite>')[0]["passed"])

    def test_unplanned_results_are_rejected(self):
        with self.assertRaises(ValueError):
            module.route_results([{"name": "home"}], '<testsuite><testcase name="other" status="SUCCESS"/></testsuite>')


if __name__ == "__main__":
    unittest.main()
