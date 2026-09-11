"""Read only the current Maestro flow's UI-copied Autonomous job identity."""
import pathlib
import json
import re
import sys


def read_identity(directory, nonce):
    pattern = re.compile(r"JsConsole[^\n]*IVX_NATIVE_HANDOFF_UI=(\{[^\n]+\})")
    identities = set()
    copied = []
    for path in pathlib.Path(directory).rglob("maestro.log"):
        for record in pattern.findall(path.read_text(errors="replace")):
            payload = json.loads(record)
            if payload.get("nonce") != nonce:
                continue
            copied.append(payload)
            text = re.sub(r"[\s\u200b\u00ad]+", "", payload["text"])
            identities.update(re.findall(r"JOB_ID:(ivx-worker-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![0-9a-f-])", text, re.I))
    pathlib.Path(directory).parent.joinpath("native-handoff-ui.json").write_text(json.dumps(copied, indent=2))
    if len(identities) != 1:
        raise ValueError("Native chat must supply exactly one UI-copied job identity for this nonce")
    identity = identities.pop()
    print("Observed native job: " + identity, file=sys.stderr)
    return identity


if __name__ == "__main__":
    print(read_identity(sys.argv[1], sys.argv[2]))
