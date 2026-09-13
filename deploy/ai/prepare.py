#!/usr/bin/env python3
"""Create local credentials without printing them or overwriting existing keys."""

import os
from pathlib import Path
import secrets


def main():
    directory = Path(__file__).resolve().parent
    target = directory / ".env"
    content = (directory / ".env.example").read_text(encoding="utf-8")
    content = content.replace(
        "LITELLM_MASTER_KEY=\n", "LITELLM_MASTER_KEY=sk-" + secrets.token_hex(32) + "\n"
    ).replace("QDRANT_API_KEY=\n", "QDRANT_API_KEY=" + secrets.token_hex(32) + "\n")
    try:
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        print(".env ya existe; se conservan sus claves.")
        return
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        output.write(content)
    print(".env creado con permisos 0600. Claves guardadas sin mostrarlas.")


if __name__ == "__main__":
    main()
