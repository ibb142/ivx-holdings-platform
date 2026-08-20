# IVX-112-SENIOR-DEVELOPER-NOT-CERTIFIED

**Verdict: NOT CERTIFIED**  
Evaluated: `2026-08-20T10:30:00Z` (supersedes `2026-08-20T10:05:00Z`)  
Production SHA: `6ca1cd71f2b9602d079c141805f918279888e7da`

---

## Petición del owner: certificar los 112 con herramientas end-to-end y deploy completo

**Veredicto: NO SE PUEDE EMITIR — y la razón NO es el token de GitHub.**

### Causa raíz: la capacidad de ingeniería no existe en el código

`executeRealTool()` implementa **7 herramientas**, todas de investigación/datos de solo lectura:

```
sec_edgar_fulltext · sec_edgar_submissions · wikipedia_search
worldbank_indicator · frankfurter_fx · crm_read · crm_write
```

**Cero** escriben código, corren tests, hacen typecheck, lint, commit o deploy.
El `default` del switch devuelve `toolFailure(toolId, 'Unknown real tool')`.

### Declarado vs. real

En `backend/services/agents/role-agents.ts` se declaran **64 herramientas distintas**.
**Solo 1 es despachable. 63 no tienen implementación**, incluidas:

`run_tests` · `code_patch_proposal` · `code_read` · `lint` · `qa_scan` ·
`secret_scan` · `deploy` · `prod_deploy` · `builder`

Son *strings en una lista*, no código ejecutable.

### Sobre "full code deployment"

`deploy_to_production` aparece **47 veces** y `run_tests` **22 veces** como strings
declarados en `backend/services`. Ninguno puede ejecutarse. **No existe ninguna vía por
la que los 112 agentes puedan desplegar nada.**

### El token no es el bloqueador

Rotar el `GITHUB_TOKEN` es **necesario pero NO suficiente**. Aun con un token válido no hay
herramienta de commit, ni runner de tests, ni ruta de deploy conectada a la flota.

---

## Defecto encontrado y corregido: `fabricated-engineering-findings` (high)

**Archivo:** `backend/services/ivx-agent-runtime.ts` — `produceAgentOutput()`

La función afirmaba **trabajo completado** basándose solo en que un *nombre* de herramienta
apareciera en `contract.allowedTools`:

| Si el contrato listaba | El runtime escribía |
|---|---|
| `run_tests` | "Test/scan execution completed — results recorded" |
| `read_source_code` | "Code review performed — no critical issues found in this run" |

**No se testó, escaneó ni revisó nada** — esas herramientas ni siquiera son despachables.
Ese texto se persiste en el campo `output` de cada corrida, donde un dashboard o el owner
lo lee como prueba. Era un fake pass generado en runtime, en cada corrida.

**En honor a la verdad:** el guard de completado es **sólido** y no fue burlado.
`executeAgentRun` marca `finalStatus='completed'` solo si
`realToolUsed && sourceReference && verifiedOutput` (líneas 842-853). El texto fabricado
nunca pudo por sí solo completar una corrida. El defecto es la evidencia falsa, no un gate roto.

**Fix aplicado:** cada rama ahora declara lo que el contrato *permite*, lo marca
`NOT EXERCISED`, y una advertencia nueva lista cada herramienta declarada sin implementación.
Verificación: typecheck 0 errores; 35 nombres únicos fallando antes y después, **diff vacío**.

---

## Hallazgo: los contadores de la suite son flaky

Los contadores pasaron de **2335 pass/57 fail** a **2339 pass/53 fail** *sin cambio de código*,
y volvieron a 2335/57 en tres corridas consecutivas con el cambio aplicado. El conjunto de
**nombres únicos** que fallan es estable en **35**.

> Este es el origen de la cifra retractada "+9 pass / -4 fail / 4 reparados": era
> **flakiness entre corridas, nunca una reparación**. Los deltas deben medirse comparando
> *nombres* de tests, no contadores. Abrir defecto aparte por los tests flaky.

---

## Afirmación previa del owner bajo revisión

> "The 112 IA are complete 10/10 as senior developer audit and QA now"

**Veredicto: PARCIALMENTE CIERTA — RECHAZADA como certificación 10/10.**

### Lo que SÍ es cierto

112/112 agentes completaron una corrida real (`rec-1787194134937`): herramientas reales,
112 evidence SHAs distintos, heartbeats frescos, 0 fallidos, 0 simulados, coste 0.124 USD.
Ese trabajo es genuino y queda reconocido.

### Lo que NO es cierto

"Senior developer audit and QA" no se sostiene. **Cero agentes tienen evidencia de ingeniería.**
Medido sobre `/api/ivx/agents/real-status` — el endpoint **NO** afectado por el defecto de
desincronización:

| Campo | Agentes con dato |
|---|---|
| `changedFiles` | 0/112 |
| `tests` | 0/112 |
| `typecheck` | 0/112 |
| `lint` | 0/112 |
| `commitSha` | 0/112 |
| `deploymentEvidence` | 0/112 |
| `securityReview` | 0/112 |
| `finalStatus` | 0/112 |
| `acceptedBySeniorGate` | 0/112 |

### Por qué esto NO es el defecto conocido

Importante: esta medición **no** está contaminada por `registry-counter-desync`. Ese defecto
afecta a `/api/ivx/agents` (contadores en cero). Se re-midió contra `real-status`, que sí
reporta 112/112 completados con heartbeats reales — y aun así los 9 campos de ingeniería
salen 0/112. Los campos **no existen**; no es un problema de lectura.

### La distinción

Investigar con herramientas reales ≠ ingeniería senior. El propio Real Execution Certificate
lo delimita: *"Does NOT prove senior-grade engineering."* La flota hizo búsquedas
(wikipedia 49, crm_read 28, worldbank 24, sec_edgar 10, fx 1). **Ningún agente escribió
código, corrió un test ni desplegó nada.**

### Agentes que fallan el gate

**Del 1 al 112 — los 112.** Motivo idéntico en todos: `no_run_result_recorded`, status
`UNVERIFIED`, y los 12 campos de evidencia vacíos.

> Nota sobre `qa/evidence/autonomous/agents/agent-001..112.json`: esos 112 archivos se
> capturaron desde `GET /api/ivx/agents`, el endpoint defectuoso. Sus `totalRuns=0` /
> `evidenceCount=0` **subestiman** la realidad — las corridas sí ocurrieron. No deben
> citarse como prueba de que la flota no ejecutó nada.

### Los 6 workflows en el SHA exacto

**NO VERIFICABLE.** La API de Actions responde `HTTP 401` (token de `expo/.env` muerto).
Regla aplicada: **evidencia ausente = FAIL**. "No reportado" no es PASS.

---

## Work completed this session

### Block 1 — CRM source reference: `FIXED_LOCALLY_NOT_YET_DEPLOYED`

crm_read/crm_write now publish the real HTTPS PostgREST URL actually fetched, replacing the non-resolvable supabase:// scheme.

**Verified:** 5/5 new regression tests pass, covering all 28 affected agent numbers. Full backend suite: **57 fail antes y 57 fail después** (0 regresiones, 0 reparados). Typecheck 0 errors.

> **CORRECCIÓN — cifra retractada.** Este campo decía "57 fail baseline -> 53 fail after
> (4 pre-existing failures repaired)". Esa cifra **no se reproduce**. Re-medida dos veces en
> esta sesión, con `.env` original y con `.env` limpio: 57 antes y 57 después. El cambio suma
> 5 tests que pasan y no repara ninguno.

**Still fails because:** agentsWithSourceReference112 is measured against LIVE PRODUCTION, which runs commit 6ca1cd71 and does not contain this fix. It stays FAIL until the PR merges and Render redeploys. The code is correct; the deployment has not happened.

Evidence: `qa/evidence/engineering/ivx-eng-crm-source-reference-2026-08-20.json`

### Block 2 — Engineering evidence: `ONE_REAL_RECORD_PRODUCED_NOT_112`

Produced the senior gate's first genuine engineering evidence record with real measured verification: real changed files, real baseline-vs-after test deltas, real typecheck, and substantive security/error-handling/performance reviews.

**Attribution:** This record is attributed to the Rork senior-developer session, NOT to a fleet agent. The 112 agents did not author it. Filing it under an agent number would be a fabricated pass.

**Still fails because:** acceptedBySeniorGate remains 0/112. One human-directed engineering record is not 112 autonomous agents doing senior-grade work. The gate requires each agent to produce its own changedFiles/tests/typecheck/reviews/commit/deploy evidence.

**Hard blocker:** Fleet agents cannot produce commit or deployment evidence at all right now: the GITHUB_TOKEN on the ivx-senior-dev-01 worker returns 401 Bad credentials. Until that token is rotated, no agent can commit, so acceptedBySeniorGate cannot rise above 0 no matter how many runs execute.

## Previously established: real execution IS certified

- Certificate `IVX-112-REAL-EXEC-859548d214a09da6` · run `rec-1787194134937`
- 112/112 real execution verified · 112/112 evidence · **0 simulated**
- 112/112 real tool · 112/112 distinct evidence SHAs · 112/112 fresh heartbeats

> Scope: Proves the fleet performs REAL tool-backed research with durable per-agent evidence. Does NOT prove senior-grade engineering.

## Conditions

- PASS — `localQaGateGreen`
- PASS — `totalAgentsIs112`
- PASS — `realExecutionCertifiedOnRuntimeSha`
- PASS — `allAgentsExecutedRealTool`
- PASS — `allAgentsHaveDistinctEvidenceSha`
- PASS — `allAgentsHeartbeatFresh`
- **FAIL** — `agentsWithSourceReference112`
- **FAIL** — `acceptedBySeniorGate112`
- **FAIL** — `allSixWorkflowsPassedOnExactSha`
- PASS — `productionHealthy`
- PASS — `productionVersionMatchesSha`
- PASS — `crmSourceReferenceFixedInCode`
- **FAIL** — `crmSourceReferenceLiveInProduction`
- PASS — `firstRealEngineeringEvidenceRecorded`

**10/14 conditions pass.**

## Why 10/10 senior certification is still NOT issued

1. `acceptedBySeniorGate` = **0 de 112** requeridos. Agentes que fallan: **TODOS, del 1 al 112.** Motivo idéntico en los 112: ningún agente aporta `changedFiles`, `tests`, `typecheck`, `lint`, `securityReview` ni `deploymentEvidence`. Confirmado contra `real-status`, no contra el endpoint defectuoso.

2. **CAUSA RAÍZ:** ningún agente puede producir esa evidencia porque **no existe herramienta que haga esas acciones**. Es un problema de capacidad ausente, no de credenciales. Rotar el `GITHUB_TOKEN` del worker `ivx-senior-dev-01` (hoy 401) es necesario pero **no suficiente**.

3. Los 6 workflows requeridos **NO** se observaron verdes en `6ca1cd71`: la API de Actions responde 401. Evidencia ausente = FAIL.

4. `agentsWithSourceReference` = 84/112 en producción. El fix existe y está testeado en local, pero producción sigue en `6ca1cd71` sin él.

5. **40 alertas abiertas** en la flota, sin triage.

## Known defect: `registry-counter-desync` (high)

GET /api/ivx/agents reports totalRuns=0, evidenceCount=0, lastHeartbeat=null, health='unknown' for all 112 agents, while GET /api/ivx/agents/real-status — queried seconds later on the same production host — reports 112/112 healthy with fresh heartbeats and 112 distinct evidence SHAs. The list route reads per-process in-memory getExecutionState(); the durable run path does not update it. Any dashboard or gate reading /api/ivx/agents will under-report real work as zero.

**Impact:** This desync is why earlier evaluations concluded 'no agent has ever executed a run'.

## Note

La flota SÍ ejecutó trabajo real y eso queda reconocido. Pero investigar con herramientas no es
ingeniería senior, y los 9 campos de ingeniería salen 0/112 incluso en el endpoint bueno.

El certificado `IVX-112-SENIOR-DEVELOPER-10OF10-CERTIFIED` **NO se emite.**

## Qué haría falta para emitirlo

1. **Implementar herramientas de ingeniería reales** en `executeRealTool()`: lectura/escritura de ficheros sobre un workspace, un runner de tests que devuelva resultados reales, typecheck, lint y una ruta de commit. Sin esto, nada de lo demás importa.
2. Protegerlas tras los gates de aprobación del owner ya presentes (`productionDeploy: owner_approval_required`).
3. Rotar el `GITHUB_TOKEN` del worker para que la herramienta de commit tenga credenciales.
4. Que cada agente registre su propia evidencia: `changedFiles`, `tests`, `typecheck`, `lint`, reviews, `commitSha`, `deploymentEvidence`.
5. Desplegar el fix de `crm_read` para llevar `sourceReference` de 84/112 a 112/112.
6. Arreglar los tests flaky para que los deltas sean medibles.
7. PAT con scope `workflow` para observar los 6 workflows verdes en un mismo SHA.
8. Arreglar `registry-counter-desync` y hacer triage de las 40 alertas abiertas.
