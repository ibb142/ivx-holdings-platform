# Local dashboard checks and telemetry mock

These tools target the dashboard contract introduced in `d1f6518`. They do not connect
to Supabase, start fleet workers or deploy anything. All mock data is explicitly
marked `SIMULATED`; production health remains false and no evidence is fabricated.

Use Node, npm and the repository's Bun runtime (CI uses Bun 1.3.14). Install the
locked root and Expo dependencies if they are not already available:

```bash
bun install --frozen-lockfile
(cd expo && bun install --frozen-lockfile)
chmod +x scripts/dev/local-check.sh
./scripts/dev/local-check.sh
```

The checker runs backend TypeScript, Expo TypeScript, development-tool TypeScript
and five isolated test files: backend dashboard transport, fleet signals, mobile
health, telemetry JSON errors and the local mock through the actual mobile REST
client. Any failure stops the checker with a nonzero exit code. It does not claim
to run every repository test. Set `IVX_BUN_BIN=/absolute/path/to/bun` when Bun is not
on `PATH`.
The checker defaults `NODE_OPTIONS` to `--max-old-space-size=4096` for Expo's large
TypeScript graph and preserves an existing value when one is provided.

Start the mock in a separate terminal; it keeps running until Ctrl+C:

```bash
npm run mock:telemetry
```

Then read the same query-string route used by the dashboard:

```bash
curl --fail 'http://127.0.0.1:8080/api/ivx/live-work/agents?enterpriseDashboard=1&range=24h'
curl --fail 'http://127.0.0.1:8080/api/ivx/live-work/agents?enterpriseDashboard=1&scenario=idle'
curl -i 'http://127.0.0.1:8080/api/ivx/live-work/agents?enterpriseDashboard=1&scenario=unavailable'
```

The bare `/api/ivx/live-work/agents` URL is also a **local-only alias** for this mock
dashboard. Production's bare route serves a different agent-run feed; consumers
must keep `enterpriseDashboard=1`. The fixture uses `agentId`, `name`, `signals` and
`enterprise112` from the real client contract, rather than invented dashboard fields.

| `scenario` | Expected behavior |
| --- | --- |
| `mixed` (default) | 112 simulated agents: 12 RUNNING, 100 IDLE, zero verified outputs |
| `idle` | 112 IDLE agents |
| `stale` | 112 agents with telemetry older than the frontend freshness window |
| `incomplete` | 111 agents; the frontend rejects the snapshot |
| `ledger-error` | Simulated ledger error; the frontend rejects the snapshot |
| `unavailable` | HTTP 503 with `ok: false` |
| `unauthorized` | HTTP 401 with `ok: false` |

The query parameter changes each response without restarting the process.
`range=24h|today|yesterday|7d|30d` controls the simulated UTC date window. Agent and
category filters do not reduce the 112-agent fixture or add activity history.
Individual certificates are unsupported (HTTP 501). WebSocket and other API routes
are not implemented. CORS preflight supports the REST client's request headers.

`MOCK_PORT` defaults to `8080`, `MOCK_HOST` to `127.0.0.1`, and `MOCK_SCENARIO` to
`mixed`. For example:

```bash
MOCK_PORT=8082 MOCK_SCENARIO=stale npm run mock:telemetry
```

The mock requires no credentials. The integration tests inject only the local base
URL and a dummy owner token, then exercise the real REST client against loopback
HTTP. Running the mock does not change the app's API URL or authentication settings.

## Verification on the d1f6518 base

The full `local-check.sh` completed with exit code 0 using the available installed
dependencies: Node 24.19.0, backend/development TypeScript 7.0.2, Expo TypeScript
5.9.3 and Bun 1.3.4. The 32 selected tests passed (4 transport, 5 fleet signals,
10 mobile health, 4 JSON errors, 9 mock integration); none failed or were skipped.
The Expo check required the checker's 4 GiB Node heap setting.

The actual Node/tsx CLI was also started and queried over loopback HTTP for all
seven scenarios. Expected 200/401/503 responses were observed, followed by a clean
SIGTERM shutdown with exit code 0. This is local verification, not a CI run or a
deployment result; CI's configured Bun version is 1.3.14.
