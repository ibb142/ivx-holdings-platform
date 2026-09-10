"""Read only the current Maestro flow's UI-copied Autonomous job identity."""
import pathlib
import re
import sys


def read_identity(directory, nonce):
    pattern = re.compile(
        r"JsConsole[^\n]*IVX_NATIVE_HANDOFF_JOB_ID=(ivx-worker-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}) NONCE="
        + re.escape(nonce) + r"(?:\s|$)"
    )
    identities = set()
    for path in pathlib.Path(directory).rglob("maestro.log"):
        identities.update(pattern.findall(path.read_text(errors="replace")))
    if len(identities) != 1:
        raise ValueError("Native chat must supply exactly one UI-copied job identity for this nonce")
    return identities.pop()


if __name__ == "__main__":
    print(read_identity(sys.argv[1], sys.argv[2]))
