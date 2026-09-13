# Autonomous + 112 IA: revisión de los bloques propuestos

Base inspeccionada: `fcc452be87d5214051df8eed58b77433508b0d71`.
Fecha: 2026-09-13. Alcance: compatibilidad de código, contratos SQL y QA local.

**Dictamen: los bloques no son integrables como reemplazos completos. Tampoco
demuestran operación 24/7.** Varias funciones ya existen con contratos distintos;
el script propuesto contiene un error de sintaxis y la conciliación consulta
columnas inexistentes. Esta revisión conserva las implementaciones canónicas.

## Cambios preparados en esta rama

1. `backend/services/ivx-database-pools.ts`: permite ajustar los dos pools grandes
   mediante variables explícitas, valida el presupuesto total de este administrador
   y rechaza mezclar presupuestos distintos entre creaciones de pools. Conserva
   getters, valores predeterminados, conexiones independientes para assignment,
   heartbeat, repair, telemetry y presence, TLS verificado y deadlines existentes.
2. `backend/services/ivx-failed-agent-recovery.ts` y
   `scripts/ops/reconcile-failed-agents.ts`: diagnóstico de solo lectura por
   `run_id` y agentes explícitos. Usa `created_at`/`finished_at`, estados de ejecución
   en minúsculas, la ejecución más reciente dentro del run elegido, tiempo del
   servidor y versiones bigint como texto. Señala leases activos, evidencia,
   tareas terminales y filas ausentes. No autoriza repetir una acción externa.
3. `backend/api/ivx-agent-work-ledger-api.ts`: contiene fallos de autenticación
   y lectura, responde `503 / AGENT_LEDGER_UNAVAILABLE` sin datos internos y
   devuelve `AGENT_LEDGER_INGEST_UNCONFIRMED` cuando una escritura puede haber
   persistido parcialmente. Mantiene el endpoint y los mecanismos de autenticación.
4. Pruebas de configuración, diagnóstico, errores del endpoint y consulta SQL
   sobre un esquema aislado, además de las regresiones existentes.
5. Workflow `IVX autonomous recovery contract`, limitado a estos archivos:
   typecheck, regresiones y SQL aislado, con permiso de lectura y sin credenciales
   de producción.

Estos cambios no modifican los límites del entorno de producción, no reencolan
tareas, no liquidan reservas, no sustituyen `backend/hono.ts` y no aplican el
trigger propuesto. Son endurecimiento y diagnóstico, no una activación de la flota.

## Revisión por bloque

| Bloque | Problema comprobado | Contrato vigente / tratamiento |
| --- | --- | --- |
| Pools | El reemplazo elimina `getApiPool`, `getWorkerPool`, `getObserverPool` y `resetDatabasePoolsForTests`, utilizados por otros módulos. | Conservar estos exports; configurar sus presupuestos sin agregar otro administrador de conexiones. |
| Pools | `25 + 10` es un máximo por proceso; no una reserva global. Cuatro procesos podrían abrir hasta 140 conexiones cliente solamente con esos pools. La conversión a conexiones PostgreSQL depende del modo del pooler. | Contabilizar todas las réplicas, los otros pools y los servicios Supabase antes de cambiar capacidad. |
| Pools | `rejectUnauthorized: false` elimina verificación del servidor. No hay listener de error de pool. Se pierde la selección existente de URL. | Mantener `ivx-supabase-postgres-tls.ts`, la CA, eliminación de parámetros TLS de URL y `observePostgresPoolErrors`. |
| Pools | `terminateAll()` serial deja pools sin cerrar si el primer `end()` falla; además no impide nuevas adquisiciones durante el drenaje. | El apagado requiere primero detener consumidores/heartbeats, drenar trabajo y cerrar todos los propietarios de pools. Ese ciclo global no se implementa con el fragmento. |
| Deadline | `SET LOCAL` solo afecta la transacción actual. `statement_timeout` limita sentencias, no todo el callback, llamadas al modelo ni el tiempo total de la transacción. | La implementación existente abre `BEGIN`, instala límites locales y devuelve la conexión solamente cuando su estado es seguro. |
| Deadline | El timeout interpolado no se valida. `0` desactiva el límite; entradas inválidas fallan. Convertir todo `57014` a un nuevo Error pierde SQLSTATE y atribuye una cancelación necesariamente a este timeout. | Conservar `queryWithPostgresDeadline` y su clasificación de cancelación/transportes, sin reejecutar mutaciones ambiguas. |
| Deadline / claim | `query_timeout=12000` puede vencer antes de `statement_timeout=15000`. `catch { await ROLLBACK }` puede enmascarar el error original y `release()` puede devolver un cliente de estado incierto. | La conexión se destruye ante fallo de transporte/commit ambiguo; un rollback confirmado permite reutilización en los casos ya cubiertos por pruebas. |
| Claim | La nueva interfaz solo reconoce cinco estados. El motor real tiene un ciclo más amplio, incluidos QA, despliegue, verificación, bloqueo y reintento. | Conservar `Task`, las transiciones y los RPC de `ivx-postgres-autonomous-task-store.ts`. |
| Claim | `lease_holder` recibe un UUID, pero el runtime identifica la IA con `agent:ivx_holdings_N` y también comprueba el proceso propietario. | Conservar la identidad lógica de IA y la identidad de instancia, con fencing en PostgreSQL. |
| Claim | El SQL no actualiza `payload.state`, timestamps y demás campos canónicos del payload. Tampoco respeta dependencias, misión, agente asignado ni los controles de admisión existentes. | Usar claim/start batch existentes; no crear otra ruta de admisión. |
| Claim / índice | `priority` usa `critical/high/medium/low`; orden alfabético `DESC` no es prioridad de negocio. | El RPC usa un `CASE` y desempata por fecha límite, valor, orden de ejecución y antigüedad. Un índice debe corresponder al plan real. |
| Heartbeat | El fragmento exige `RUNNING`, pero el claim solo devuelve `LEASED`. Reemplazar el enforcer borra los bucles de refill/start/heartbeat/shutdown. | Conservar start y heartbeat batch, aislamiento del canal y comprobación de instancia. |
| Heartbeat | El token/version solos no integran cancelación del trabajo, guardas de efectos externos ni propagación de la nueva versión. `bigint` tampoco debe tratarse ciegamente como `number`. | Probar pérdida de lease y rechazo del propietario antiguo de extremo a extremo; no deducirlo de un `UPDATE` aislado. |
| Presupuesto | `financial_clearance_approved`, `raw_invoice_cost` y `budget_settled` no están en `ivx_autonomous_tasks`. | El presupuesto se reserva y liquida en `ivx_ai_budget_reservations` mediante `ivx_ai_budget_reserve/finish/status`. |
| Presupuesto | Una lectura booleana no reserva gasto de forma atómica. Dos workers pueden aprobar el mismo saldo disponible. | Conservar la reserva atómica previa a la llamada y el tratamiento fail-closed del estado desconocido. |
| Settlement | `fn_reconcile_uncertain_budget_batch(1, receipts)` rechaza más de un recibo. `CompactReceipt` no contiene los campos del contrato SQL. | El PR #1858 requiere reservation ID, worker, request SHA, generation ID, modelo, coste en nanodólares como texto, tiempos y hash del recibo autenticado. |
| Settlement | La firma aportada por el llamador no prueba una factura. Marcar todas las tareas liquidadas ignora locks saltados, cantidades parciales y confirmación del commit. | Conservar `ivx-uncertain-budget-reconciliation.mjs`: consulta al proveedor, validación por reserva y confirmación de filas de recibo/estado settled. |
| Self-healing | `claimCandidateSecureLease` no es un export real. `ivx_orchestrator_authority` no es el contrato del control de emergencia vigente. | Usar `CandidateStore.acquireLock/saveCandidateWithLease/recordPhaseFailure`; el control vigente consulta `ivx_agent_controls`. |
| Self-healing | La ausencia de la fila de control permite continuar. `targetVersion=1` no representa la revisión real. El cuerpo solo imprime un mensaje. | La autoridad desconocida debe bloquear. Una misión necesita evidencia, cambio, pruebas, commit/PR y verificación reales. |
| Self-healing | Guardar `err.message` puede exponer datos y viola el contrato de códigos de motivo seguros; `.catch(() => {})` oculta el fallo de persistencia. | Registrar fase, motivo seguro y attempt con la API existente, conservando resultado desconocido cuando no hay confirmación. |
| SLO / Hono | Agrupar `ivx_agent_states` por status no entrega 112 filas ni evidencia productiva. Reemplazar `hono.ts` elimina otras rutas. El endpoint propuesto ya existe. | Conservar `ivx-agent-work-ledger-api.ts`, verificador de tres capas y SLO existente. Un heartbeat no equivale a trabajo terminado. |
| SLO / Hono | `details: err.message` expone datos internos. Un HTTP 200 no demuestra certificación de las 112 IA. | Se preparan errores seguros; los fallos de lectura mantienen resultado no disponible y sin contadores inventados. |
| Recuperación | `const targetFailedAgents =;` no compila. `ivx_agent_executions.updated_at` no existe. Los estados reales son `failed/unknown/completed`, no `FAILED/UNKNOWN`. | El diagnóstico nuevo usa columnas reales y exige identificar la ejecución. |
| Recuperación | Recorrer todo el histórico repite decisiones antiguas. Resetear `RUNNING` sin lease vencido puede causar ejecución doble. No se sincroniza payload, expiry ni heartbeat. | Selección acotada por run, sin `UPDATE`. Leases vencidos/reintentos programados pertenecen al RPC canónico de claim. |
| Recuperación | `FAILED` se trata como terminal por el motor. El fragmento imprime éxito aunque el `UPDATE` no cambie ninguna fila. Un fallo puede haber creado un efecto externo. | Mantener la evidencia final y reconciliar antes de crear trabajo posterior; no reutilizar por fuerza el estado anterior. |
| SQL Candidate | El trigger sobre `ivx_candidate_lessons` usa `completed_at`, `token` y `expires_at` de `ivx_candidate_leases`; fallaría al ejecutarse sobre la tabla equivocada. | La migración #1859 separa leases y evidencia inmutable. No aplicar este trigger. |
| SQL Candidate | Exigir subir `version` en cada escritura no coincide con guardar el candidato de la versión adquirida; impedir toda rotación activa también elimina el fencing por revisión superior. | Mantener los RPC, validación owner/token/version, expiración comprobada antes de completar y duplicado idéntico idempotente. |

## Uso de los cambios

Variables nuevas, leídas al crear los pools:

| Variable | Producción por defecto | CI/test por defecto |
| --- | ---: | ---: |
| `IVX_PG_API_MAX_CONNECTIONS` | 12 | 6 |
| `IVX_PG_TASKS_MAX_CONNECTIONS` | 5 | 1 |
| `IVX_PG_PROCESS_CONNECTION_LIMIT` | 22 | 12 |

El total administrado es `api + tasks + 5`. Los cinco canales aislados conservan
una conexión cada uno. Un presupuesto inválido bloquea la creación; un cambio de
presupuesto con pools ya creados requiere reiniciar. Los pools siguen siendo lazy.
El lector de owner-control y otros administradores no están incluidos en este
techo. Esto es configuración local, no descubrimiento automático de réplicas ni
una garantía global de capacidad.

Diagnóstico, usando las credenciales existentes del mismo proyecto:

```sh
bun scripts/ops/reconcile-failed-agents.ts \
  --run-id=RUN_ID_EXACTO \
  --agent-numbers=1,18,50,51,53,62,64,68,97,101
```

Los IDs del ejemplo corresponden al grupo fallido del audit anterior; deben
revalidarse para el run seleccionado. `--apply` no existe. El informe conserva
`retryAuthorized: false`, `mutationsPerformed: 0` y presupuesto `NOT_CHECKED`.
Un diagnóstico ejecutado correctamente puede contener filas ausentes o evidencia
incompleta; no es una certificación de recuperación.

## QA reproducible

Resultado local: **105 pruebas Bun + 13 pruebas de presupuesto + 5 pruebas SQL
= 123 aprobadas, cero fallidas**. Typecheck del backend y `git diff --check`
aprobados. Este resultado no representa CI remoto ni prueba de producción.

Instalar con `bun install --frozen-lockfile --ignore-scripts`. Ejecutar:

```sh
bun test backend/services/ivx-database-pools.test.ts \
  backend/services/ivx-postgres-deadline.test.ts \
  backend/services/ivx-candidate-store.test.ts \
  backend/services/ivx-fleet-slo.test.ts \
  backend/services/ivx-failed-agent-recovery.test.ts \
  backend/api/ivx-agent-work-ledger-api.test.ts \
  backend/ivx-agent-work-ledger.test.ts \
  backend/services/ivx-postgres-autonomous-task-store.test.ts
node --test backend/services/ivx-global-ai-budget-settlement.test.mjs \
  backend/services/ivx-uncertain-budget-reconciliation.test.mjs
./node_modules/.bin/tsc --noEmit -p backend/tsconfig.json
```

La prueba SQL usa el mismo mecanismo de dependencia aislada que la prueba
Candidate Store. No añade PGlite a dependencias de producción:

```sh
npm install --prefix /tmp/ivx-sql-qa --ignore-scripts @electric-sql/pglite@0.3.14
IVX_PGLITE_MODULE=/tmp/ivx-sql-qa/node_modules/@electric-sql/pglite \
  node --test qa/failed-agent-recovery-postgres.test.mjs
```

Prueba selección por run, agente ausente, conservación exacta de bigint,
tiempo PostgreSQL, evidencia desconocida y cero cambios dentro de una transacción
de solo lectura. No prueba carreras entre conexiones nativas, carga de Render ni
conectividad de Supabase.

## Lo que falta para cerrar 24/7

| Prioridad | Trabajo pendiente | Evidencia de cierre |
| --- | --- | --- |
| P0 | Resolver fallos intermitentes de checkout/setup/consulta y medir capacidad total por proceso, réplica, pooler y servicio. | Readiness/cola/control disponibles durante carga; latencias, conexiones, espera y SQLSTATE medidos. Aumentar timeouts solo no demuestra resolución. |
| P0 | Reconciliar cada ejecución `unknown` y cada coste incierto con su recibo real antes de repetir efectos. | Identidad task/run/provider consistente; una reserva, una factura, un asiento; fallo de ACK sin doble cobro. |
| P0 | Asegurar recibos/checkpoints recuperables tras reinicio, incluida pérdida del proceso antes de persistir `generation_id`. | Reinicio controlado que retoma conciliación sin repetir llamada al modelo ni liberar gasto desconocido. Los timers de retry en memoria no bastan por sí solos. |
| P0 | Completar self-healing real con control de emergencia disponible y fallo cerrado. | Misión falla → candidato → parche → QA → commit/PR → despliegue autorizado → verificación del mismo SHA. Un `console.log` no es ejecución. |
| P0 | Verificar fencing, heartbeat, cancelación y recuperación con procesos concurrentes y efectos externos idempotentes. | Un ganador por tarea, propietario antiguo rechazado, ninguna escritura posterior a pérdida de autoridad, reinicio sin ejecución duplicada. |
| P1 | Repetir certificación de las 112 IA después de corregir infraestructura y persistencia. | 112 resultados individuales con fuente, tool result, estado final y evidencia durable verificable. Registrar fallidos/desconocidos por separado. |
| P1 | Hacer que despliegue siga los checks requeridos y el SHA aprobado. | Configuración real de Render/GitHub coincide con la política, CI pasa y `/version` corresponde al commit validado. |
| P1 | Probar 24 horas continuas y caídas controladas del servicio/proveedor/BD. | Ventana completa de heartbeat, trabajo útil, fallos, recovery, cola, gasto y reinicios; sin rellenar huecos con contadores simulados. |
| P2 | Completar los flujos de landing, Android e iOS necesarios para la misión. | Entregables y flujos de usuario verificados en el mismo release, con sus propios resultados. |

El audit anterior registró 102/112 resultados aprobados y 10 fallidos, junto con
readiness/telemetría incompletas. Es evidencia histórica de esa ejecución, no un
estado actualizado por esta rama. Ninguna prueba local de este cambio certifica
las 112 IA activas ahora ni completa una ventana de 24 horas.

Referencias de semántica: [node-postgres Pool](https://node-postgres.com/apis/pool),
[PostgreSQL SET LOCAL](https://www.postgresql.org/docs/17/sql-set.html),
[conexiones Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres).
