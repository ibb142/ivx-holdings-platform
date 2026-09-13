import json
import unittest
from unittest.mock import patch

import landing_cloudfront_control_audit as audit


class CloudFrontAuditTests(unittest.TestCase):
    def test_wrong_account_stops_before_resource_reads(self):
        calls = []
        def read(*args):
            calls.append(args)
            return {"Account": "different-account"}
        report = audit.inspect(read)
        self.assertEqual(report["identity"], "UNEXPECTED_ACCOUNT")
        self.assertEqual(calls, [("sts", "get-caller-identity")])

    def test_missing_access_never_means_no_subscription(self):
        def read(service, operation, *args):
            if service == "sts":
                return {"Account": audit.ACCOUNT}
            return {"lookup_error": "AccessDeniedException"}
        report = audit.inspect(read)
        self.assertFalse(report["subscriptions"]["listing_complete"])
        self.assertEqual(report["subscriptions"]["lookup_error"], "AccessDeniedException")
        self.assertFalse(report["certified"])

    def test_pagination_is_bounded_and_other_resources_are_not_logged(self):
        pages = []
        def read(service, operation, *args):
            if service == "sts":
                return {"Account": audit.ACCOUNT, "Arn": "private-caller"}
            if service == "pricing-plan-manager":
                pages.append(args)
                return {"nextToken": "private-token", "subscriptionSummaries": [
                    {"resourceArns": ["unrelated-resource"], "planTier": "OTHER_PLAN"},
                    {"resourceArns": [audit.DISTRIBUTION_ARN], "planFamily": "CloudFront",
                     "planTier": "FREE", "status": "ACTIVE", "arn": "private-subscription", "eTag": "private-etag"}]}
            return {"lookup_error": "AccessDeniedException"}
        report = audit.inspect(read)
        self.assertEqual(len(pages), 3)
        self.assertFalse(report["subscriptions"]["listing_complete"])
        encoded = json.dumps(report)
        for value in ["private-caller", "private-token", "unrelated-resource", "OTHER_PLAN", "private-subscription", "private-etag"]:
            self.assertNotIn(value, encoded)

    def test_mutating_commands_are_rejected_before_execution(self):
        with patch.object(audit.subprocess, "run") as run:
            with self.assertRaises(ValueError):
                audit.aws("cloudfront", "update-distribution")
            run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
