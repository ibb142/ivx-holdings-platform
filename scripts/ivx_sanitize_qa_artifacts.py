"""Remove credentials from QA evidence; any unsafe file blocks artifact upload."""
import base64
import html
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import quote, quote_plus

REDACTED = '[REDACTED]'
SECRET_KEY = re.compile(r'password|passwd|authorization|token|secret|service[_-]?role|private[_-]?key', re.I)
JWT = re.compile(r'\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b')
MEDIA = {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4'}
ARCHIVES = {'.zip', '.gz', '.tgz', '.bz2', '.xz', '.7z'}


class UnsafeEvidence(Exception):
    pass


def secret_variants(environment):
    variants = set()
    for name, value in environment.items():
        if not SECRET_KEY.search(name) or name.endswith('_BINDING') or not value:
            continue
        if value == REDACTED or value.startswith('${') or set(value) == {'*'}:
            continue
        if len(value) < 4:
            raise UnsafeEvidence('Credential too short for safe text redaction')
        variants.update((value, json.dumps(value)[1:-1], json.dumps(value, ensure_ascii=False)[1:-1],
                         html.escape(value), quote(value, safe=''), quote_plus(value, safe=''),
                         base64.b64encode(value.encode()).decode(),
                         base64.urlsafe_b64encode(value.encode()).decode().rstrip('=')))
    return sorted(variants, key=len, reverse=True)


def redact_fields(value):
    if isinstance(value, dict):
        return {key: REDACTED if SECRET_KEY.search(key) and isinstance(item, (str, dict, list))
                else redact_fields(item) for key, item in value.items()}
    if isinstance(value, list):
        return [redact_fields(item) for item in value]
    return value


def sanitize(roots, environment):
    variants = secret_variants(environment)
    inspected = changed = 0
    for root in map(Path, roots):
        if root.is_symlink():
            raise UnsafeEvidence('Symlink root')
        if not root.exists():
            continue
        files = root.rglob('*') if root.is_dir() else [root]
        for path in files:
            if path.is_symlink():
                raise UnsafeEvidence('Symlink evidence')
            if not path.is_file():
                continue
            if any(secret in str(path) for secret in variants):
                raise UnsafeEvidence('Credential in artifact path')
            inspected += 1
            data = path.read_bytes()
            if path.suffix.lower() in MEDIA:
                if any(secret.encode() in data for secret in variants):
                    raise UnsafeEvidence('Credential in binary evidence')
                continue
            if path.suffix.lower() in ARCHIVES:
                raise UnsafeEvidence('Uninspected archive')
            try:
                content = data.decode('utf-8')
            except UnicodeDecodeError:
                raise UnsafeEvidence('Unsafe binary evidence') from None
            if path.suffix.lower() == '.json':
                try:
                    content = json.dumps(redact_fields(json.loads(content)), ensure_ascii=False, indent=2) + '\n'
                except json.JSONDecodeError:
                    raise UnsafeEvidence('Invalid JSON evidence') from None
            for secret in variants:
                content = content.replace(secret, REDACTED)
            content = JWT.sub(REDACTED, content)
            if any(secret in content for secret in variants):
                raise UnsafeEvidence('Credential remains')
            encoded = content.encode()
            if encoded != data:
                path.write_bytes(encoded)
                changed += 1
    return {'inspectedFiles': inspected, 'sanitizedFiles': changed}


if __name__ == '__main__':
    try:
        if len(sys.argv) < 2:
            raise UnsafeEvidence('No artifact roots')
        print(json.dumps({'artifactSanitization': 'passed', **sanitize(sys.argv[1:], os.environ)}))
    except (UnsafeEvidence, OSError):
        print('QA_ARTIFACT_SANITIZATION_FAILED', file=sys.stderr)
        sys.exit(1)
