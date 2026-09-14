# Recuperación manual de tareas FAILED

`scripts/ops/recover-failed-patrols.mjs` previsualiza hasta diez tareas fallidas recientes. Las tareas de reparación y de QA se distinguen mediante el `idempotency_key` incluido en el informe; el nombre del script no convierte cualquier fallo en un patrol recuperable.

Configure `IVX_PATROL_RECOVERY_DATABASE_URL` con una conexión al proyecto `kvclcdjmjghndxsngfzb`. También acepta, en ese orden, `IVX_BUDGET_RECONCILIATION_DATABASE_URL` y `DATABASE_URL`. No incluya credenciales en comandos, archivos versionados ni informes. La conexión conserva verificación TLS y utiliza el certificado CA existente del repositorio.

```sh
# Previsualización: no escribe tareas ni eventos.
node scripts/ops/recover-failed-patrols.mjs

# Revise tareas concretas usando los IDs reales devueltos por la previsualización.
node scripts/ops/recover-failed-patrols.mjs --task-ids=ID_REAL

# Aplicación explícita sobre esos IDs; registra el motivo en la evidencia.
node scripts/ops/recover-failed-patrols.mjs --apply --task-ids=ID_REAL --reason="Causa corregida y recuperación revisada"
```

`--limit` acepta de 1 a 10. Aplicar requiere IDs concretos y un motivo. Los nombres `ID_REAL` son marcadores de ejemplo y deben sustituirse por los identificadores revisados.

La previsualización limita filas antes de examinar JSON. Dentro de cada transacción se vuelve a comprobar `FAILED`, la versión exacta, el estado del payload, la expiración del lease, la antigüedad del heartbeat y los límites existentes de reintentos. Un lease sin fecha de expiración y con propietario no se presume vencido. La recuperación consume un reintento; no reinicia los límites de intentos ni la ventana de quince minutos.

La actualización incrementa la versión en PostgreSQL, limpia los campos de lease de columnas y payload, y conserva el primer inicio, la evidencia, metadatos y referencias financieras. El error y cierre anteriores quedan en un evento `manual_failed_task_requeued` insertado en la misma transacción. Si falla la auditoría, se revierte la actualización.

El informe sólo incluye una recuperación en `applied` después de recibir confirmación de COMMIT. `COMMIT_OUTCOME_UNKNOWN` requiere consultar la tarea y el evento con ese `recoveryRunId`; el script no reintenta automáticamente. Las transacciones confirmadas antes de otro fallo permanecen reflejadas en el informe. Un fallo de conexión o ejecución produce código de salida distinto de cero y el cliente se cierra una sola vez.

Reencolar no corrige por sí solo la causa del fallo ni acredita que el agente terminó la tarea. Los controles de emergencia, permisos, presupuesto y admisión siguen siendo responsabilidad del runtime existente.

## Prueba aislada

El workflow `IVX failed patrol recovery PostgreSQL proof` ejecuta las pruebas sobre PostgreSQL 17 con una base desechable local. El mismo contrato comprueba previsualización sin escrituras, leases vigentes/desconocidos, reintentos agotados, versiones mayores que el entero seguro de JavaScript, concurrencia, repetición, rollback de auditoría y pérdida de confirmación de COMMIT.
