"""Assign free host ports only to the disposable CI Supabase project."""
from contextlib import ExitStack
from copy import deepcopy
import json
import os
from pathlib import Path
import re
import socket
import sys
import tomllib


def configure(config_path, temp_root, run_id, attempt):
    path = Path(config_path).resolve()
    root = Path(temp_root).resolve()
    if not path.is_relative_to(root) or path.name != 'config.toml':
        raise ValueError('Only a generated config inside RUNNER_TEMP may be changed')
    if not re.fullmatch(r'[0-9]+', run_id) or not re.fullmatch(r'[0-9]+', attempt):
        raise ValueError('Numeric CI run identity is required')
    source = path.read_text()
    before = tomllib.loads(source)
    for section, key in [('api', 'port'), ('db', 'port'), ('db', 'shadow_port')]:
        if not isinstance(before.get(section, {}).get(key), int):
            raise ValueError(f'Missing generated local setting: {section}.{key}')
    if not isinstance(before.get('auth', {}).get('jwt_expiry'), int):
        raise ValueError('Missing generated local Auth expiry')

    def setting(text, section, key, value):
        block = re.compile(r'(?ms)^(\[' + re.escape(section) + r'\][^\n]*\n)(.*?)(?=^\[|\Z)')
        matches = list(block.finditer(text))
        if len(matches) != 1:
            raise ValueError(f'Expected one {section} section')
        body, count = re.subn(r'(?m)^([ \t]*' + re.escape(key) + r'[ \t]*=[ \t]*)\d+([ \t]*(?:#.*)?)$',
                              lambda m: m[1] + str(value) + m[2], matches[0][2])
        if count != 1:
            raise ValueError(f'Expected one {section}.{key} setting')
        match = matches[0]
        return text[:match.start(2)] + body + text[match.end(2):]

    with ExitStack() as stack:
        ports = []
        for _ in range(3):
            reservation = stack.enter_context(socket.socket())
            reservation.bind(('0.0.0.0', 0))
            ports.append(reservation.getsockname()[1])
        project = f'ivx-landing19-{run_id}-{attempt}'
        text, count = re.subn(r'(?m)^project_id[ \t]*=[ \t]*"[^"\n]*"[ \t]*$',
                              f'project_id = "{project}"', source)
        if count != 1:
            raise ValueError('Expected one generated project identity')
        for (section, key), port in zip([('api', 'port'), ('db', 'port'), ('db', 'shadow_port')], ports):
            text = setting(text, section, key, port)
        # Keep the existing expired-token acceptance policy exactly as before.
        text = setting(text, 'auth', 'jwt_expiry', 60)
        expected = deepcopy(before)
        expected['project_id'] = project
        expected['api']['port'], expected['db']['port'], expected['db']['shadow_port'] = ports
        expected['auth']['jwt_expiry'] = 60
        if tomllib.loads(text) != expected:
            raise ValueError('Unexpected change outside local identity, ports and existing test expiry')
        path.write_text(text)
    # Docker must bind after these reservations close. A subsequent conflict
    # remains a failed startup; this helper never retries, stops or deletes peers.
    return {'projectId': project, 'apiPort': ports[0], 'dbPort': ports[1], 'shadowPort': ports[2]}


if __name__ == '__main__':
    print(json.dumps(configure(sys.argv[1], os.environ['RUNNER_TEMP'],
                               os.environ['GITHUB_RUN_ID'], os.environ['GITHUB_RUN_ATTEMPT'])))
