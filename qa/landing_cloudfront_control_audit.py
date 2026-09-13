"""Bounded, read-only observations for the existing landing distribution.

This reports configuration and lookup failures, not deployment acceptance.
Only allowlisted summary fields reach CI logs; raw AWS responses stay in memory.
"""
import datetime
import json
import os
import re
import subprocess


ACCOUNT = "206818124217"
DISTRIBUTION = "E1C0DEI0VKCUYN"
DISTRIBUTION_ARN = f"arn:aws:cloudfront::{ACCOUNT}:distribution/{DISTRIBUTION}"
FUNCTION_ARN = f"arn:aws:cloudfront::{ACCOUNT}:function/ivx-www-to-apex"
READS = {
    ("sts", "get-caller-identity"),
    ("cloudfront", "get-distribution"),
    ("cloudfront", "describe-function"),
    ("service-quotas", "list-service-quotas"),
    ("pricing-plan-manager", "list-subscriptions"),
}


def aws(service, operation, *args):
    if (service, operation) not in READS:
        raise ValueError("Only the reviewed AWS read operations are allowed")
    command = ["aws", service, operation, *args, "--region", "us-east-1",
               "--output", "json", "--no-cli-pager", "--cli-connect-timeout", "4",
               "--cli-read-timeout", "8"]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=20,
                                env={**os.environ, "AWS_MAX_ATTEMPTS": "1"})
    except FileNotFoundError:
        return {"lookup_error": "AWS_CLI_UNAVAILABLE"}
    except subprocess.TimeoutExpired:
        return {"lookup_error": "LOOKUP_TIMEOUT"}
    if result.returncode:
        code = re.search(r"An error occurred \(([A-Za-z0-9_-]+)\)", result.stderr)
        return {"lookup_error": code.group(1) if code else "AWS_CLI_COMMAND_FAILED"}
    try:
        data = json.loads(result.stdout)
        return data if isinstance(data, dict) else {"lookup_error": "INVALID_RESPONSE"}
    except ValueError:
        return {"lookup_error": "INVALID_RESPONSE"}


def inspect(read=aws):
    report = {"evidence_type": "CLOUDFRONT_CONTROL_PLANE_OBSERVATIONS",
              "observed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "source_sha": os.environ.get("GITHUB_SHA"), "certified": False,
              "mutations_performed": 0}
    identity = read("sts", "get-caller-identity")
    if identity.get("Account") != ACCOUNT:
        report["identity"] = identity.get("lookup_error", "UNEXPECTED_ACCOUNT")
        return report
    report["identity"] = "EXPECTED_ACCOUNT"
    distribution = read("cloudfront", "get-distribution", "--id", DISTRIBUTION)
    value = distribution.get("Distribution", {})
    if distribution.get("lookup_error") or value.get("ARN") != DISTRIBUTION_ARN:
        report["distribution"] = {"lookup_error": distribution.get("lookup_error", "UNEXPECTED_DISTRIBUTION")}
    else:
        config = value.get("DistributionConfig", {})
        behavior = config.get("DefaultCacheBehavior", {})
        associations = behavior.get("FunctionAssociations", {}).get("Items", [])
        aliases = config.get("Aliases", {}).get("Items", [])
        report["distribution"] = {
            "status": value.get("Status"), "enabled": config.get("Enabled"),
            "apex_alias_present": "ivxholding.com" in aliases,
            "www_alias_present": "www.ivxholding.com" in aliases,
            "response_headers_policy_attached": bool(behavior.get("ResponseHeadersPolicyId")),
            "redirect_attached": any(a.get("EventType") == "viewer-request" and
                                     a.get("FunctionARN") == FUNCTION_ARN for a in associations),
            "other_viewer_request_function": any(a.get("EventType") == "viewer-request" and
                                                a.get("FunctionARN") != FUNCTION_ARN for a in associations),
        }
    function = read("cloudfront", "describe-function", "--name", "ivx-www-to-apex", "--stage", "LIVE")
    report["redirect_function"] = ({"lookup_error": function["lookup_error"]} if function.get("lookup_error") else
        {"live_version_present": function.get("FunctionSummary", {}).get("FunctionMetadata", {}).get("FunctionARN") == FUNCTION_ARN})
    quotas = read("service-quotas", "list-service-quotas", "--service-code", "cloudfront", "--max-items", "100")
    report["distribution_quotas"] = ({"lookup_error": quotas["lookup_error"]} if quotas.get("lookup_error") else
        {"listing_complete": not bool(quotas.get("NextToken")), "values": [
            {k: q.get(k) for k in ("QuotaName", "Value", "Adjustable")}
            for q in quotas.get("Quotas", [])
            if re.search(r"distributions per (?:aws )?account", q.get("QuotaName", ""), re.I)]})
    subscriptions = {"listing_complete": False, "matching_subscriptions": []}
    token = None
    for _ in range(3):
        args = ["--no-paginate"] + (["--next-token", token] if token else [])
        page = read("pricing-plan-manager", "list-subscriptions", *args)
        if page.get("lookup_error"):
            subscriptions["lookup_error"] = page["lookup_error"]
            break
        if not isinstance(page.get("subscriptionSummaries"), list):
            subscriptions["lookup_error"] = "INVALID_RESPONSE"
            break
        for item in page["subscriptionSummaries"]:
            if DISTRIBUTION_ARN in item.get("resourceArns", []):
                subscriptions["matching_subscriptions"].append(
                    {k: item.get(k) for k in ("planFamily", "planTier", "status")})
        token = page.get("nextToken")
        if not token:
            subscriptions["listing_complete"] = True
            break
    # No listed subscription is not evidence that pay-as-you-go is invalid.
    report["subscriptions"] = subscriptions
    return report


if __name__ == "__main__":
    observation = inspect()
    print(json.dumps(observation, sort_keys=True))
    raise SystemExit(0 if observation.get("identity") == "EXPECTED_ACCOUNT" else 1)
