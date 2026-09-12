"""Bounded, read-only discovery of the registered Casa Rosario originals."""
import datetime
import json
import os
from pathlib import Path
import subprocess

ACCOUNT = "206818124217"
BUCKET = "ivxholding.com"
REGISTERED = [
    "videos/original/b8788d0c-0558-43fb-a3dd-4ccdc6f441c8/casa-rosario.mp4",
    "media/casa-rosario/casa-rosario-tour-1080p.mp4",
]
TOKENS = ["rosario", "b8788d0c", "e7ab379a", "fe407c4b"]


def aws(service, operation, *args):
    assert (service, operation) in {
        ("sts", "get-caller-identity"),
        ("s3api", "list-objects-v2"),
        ("s3api", "head-object"),
        ("s3api", "list-object-versions"),
    }
    command = ["aws", service, operation, *args, "--region", "us-east-1",
               "--output", "json", "--no-cli-pager", "--cli-connect-timeout", "10",
               "--cli-read-timeout", "20"]
    result = subprocess.run(command, capture_output=True, text=True, timeout=45)
    if result.returncode:
        # Never print raw provider errors or credential material.
        return {"error": "NotFound" if "404" in result.stderr else
                "AccessDenied" if "AccessDenied" in result.stderr else "AWS_READ_FAILED"}
    return json.loads(result.stdout)


def relevant(key):
    return any(token in key.lower() for token in TOKENS)


receipt = {"item": "15.6", "mode": "read_only_source_discovery",
           "startedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
           "sourceSha": os.environ.get("GITHUB_SHA"), "bucket": BUCKET,
           "certified": False, "lists": [], "registered": []}
try:
    identity = aws("sts", "get-caller-identity")
    assert identity.get("Account") == ACCOUNT, "Unexpected AWS deployment account"
    receipt["expectedAccountVerified"] = True
    for prefix in ["videos/", "media/casa-rosario/"]:
        listing = aws("s3api", "list-objects-v2", "--bucket", BUCKET,
                      "--expected-bucket-owner", ACCOUNT, "--prefix", prefix,
                      "--max-keys", "1000", "--no-paginate")
        rows = listing.get("Contents", [])
        receipt["lists"].append({"prefix": prefix, "objectsInspected": len(rows),
            "truncated": listing.get("IsTruncated"), "error": listing.get("error"),
            "matches": [{k: obj.get(k) for k in ["Key", "Size", "LastModified", "ETag"]}
                        for obj in rows if relevant(obj["Key"])]})
    for key in REGISTERED:
        head = aws("s3api", "head-object", "--bucket", BUCKET, "--key", key,
                   "--expected-bucket-owner", ACCOUNT)
        versions = aws("s3api", "list-object-versions", "--bucket", BUCKET,
                       "--expected-bucket-owner", ACCOUNT, "--prefix", key,
                       "--max-keys", "100", "--no-paginate")
        receipt["registered"].append({"key": key,
            "head": {k: head.get(k) for k in ["ContentType", "ContentLength", "ETag", "error"]},
            "versionError": versions.get("error"), "versionsTruncated": versions.get("IsTruncated"),
            "versions": [{k: obj.get(k) for k in ["Key", "VersionId", "IsLatest", "Size", "LastModified"]}
                         for obj in versions.get("Versions", []) if obj["Key"] == key],
            "deleteMarkers": [{k: obj.get(k) for k in ["Key", "VersionId", "IsLatest", "LastModified"]}
                              for obj in versions.get("DeleteMarkers", []) if obj["Key"] == key]})
finally:
    receipt["finishedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    Path("qa-results").mkdir(exist_ok=True)
    Path("qa-results/phase1-media-source-discovery.json").write_text(json.dumps(receipt, indent=2))
    print(json.dumps(receipt))
