# Revisión del parche del dashboard de flota

Base: `594f61291292ce88ad6d784f0c12bb025fff785a`, posterior al PR #1862.
Fecha: 2026-09-13. Alcance: ruta móvil, interpretación de salud y errores de lectura.

## Dictamen sobre el bloque propuesto

La ruta `/api/ivx/live-work/agents` existe y sí la consume el móvil. El reemplazo
propuesto no satisface su contrato. Una respuesta HTTP 200 o una fila con
heartbeat reciente no certifica trabajo productivo ni operación continua.

| Punto | Evidencia en el código | Consecuencia del reemplazo |
| --- | --- | --- |
| Import del pool | El módulo está en `backend/services/ivx-database-pools.ts`. | `./ivx-database-pools` desde `backend/hono.ts` no resuelve ese archivo. |
| Registro del servidor | `hono.ts` ya delega en `handleLiveWorkAgentsRequest` y registra el ledger por separado. | Sustituir todo el archivo elimina otras rutas; exportar `app.fetch` bajo el nombre del ledger no conserva su función original. |
| Modos de la ruta | Sin flag devuelve `{ok, agents}`; `enterpriseDashboard=1` devuelve el dashboard; `individualCerts=1` tiene prioridad y devuelve certificados. | El fragmento devuelve siempre otro dashboard y rompe consumidores y certificados. |
| Campos móviles | La pantalla lee `agentId`, `name`, departamento, responsabilidad, tareas, evidencia, `signals` y `enterprise112`. | `agent_id`, `agentName` y seis columnas no cumplen ese contrato. |
| Estados | `ivx-agent-runtime.ts` persiste `contract.status`; el contrato es `active/paused/disabled/archived`. | Filtrar ese campo por `RUNNING/QUEUED/IDLE` no mide ejecuciones. |
| Registro de 112 | El handler combina `ALL_AGENT_CONTRACTS` con ledger y señales vigentes. | Filtrar todo el registro por 60 segundos de heartbeat oculta agentes ausentes o detenidos. `registeredCount` se convierte incorrectamente en presencia reciente. |
| Prueba de trabajo | Las señales distinguen heartbeat, asignación, lease vigente y evidencia productiva. | Cualquier fila reciente basta para `OFFICIAL_RUNNING`, incluso sin trabajo ejecutándose. |
| Fallos HTTP | `getAutonomousOpsDashboard` rechaza tanto HTTP no exitoso como `ok:false`. La pantalla landing también comprueba ambos. | HTTP 200 con `ok:false` no elimina el manejo de error del cliente. Ceros inventados tampoco describen un fallo de lectura. |
| Fallo del pool | La adquisición propuesta queda fuera del `try` de telemetría. | Ese fallo puede escapar del fallback propuesto. |
| Latencia | No se aporta plan SQL, medición bajo carga ni distribución de latencias. | No está demostrada la reducción de 18 segundos a menos de 50 ms ni que el volumen consultado sea 5 GB. |

La tabla dedicada sí contiene las columnas seleccionadas en el fragmento. El
problema central es su significado y el contrato del consumidor, además de que el
lector existente soporta selección del almacén durable y no depende únicamente
de esa consulta directa.

## Correcciones incluidas

1. `expo/src/modules/ivx-owner-ai/services/ivxAutonomousOpsService.ts`: la
   normalización ya no convierte `productionHealthy:false` o ausente en `true`
   porque coincidan dos SHAs. Exige el permiso positivo del servidor, ledger
   válido y señales vigentes aceptadas por `visibleFleetSignals`, que ya usa la
   pantalla. Ese contrato comprueba antigüedad, 112 identidades y contadores.
   REST y WebSocket usan este mismo normalizador.
2. `backend/api/ivx-autonomous-ops-dashboard.ts`: un rechazo de la lectura
   compartida devuelve JSON `503`, `ok:false` y el mensaje seguro existente.
   Se conserva el registro completo con estado `UNKNOWN` cuando el ledger existe
   pero faltan señales en vivo. No se convierten fallos en una flota vacía.
3. Regresiones sobre las funciones reales del cliente y el handler delegado,
   aislando solamente dependencias de sesión, red y almacenamiento.
4. Workflow `IVX dashboard read contract`: ejecuta ambos contratos en procesos
   independientes y el typecheck del backend, con permiso de lectura y sin
   credenciales de producción.

## QA reproducible

Antes del cambio fallaron siete regresiones: cinco falsos positivos de salud y
dos rechazos de lectura sin respuesta controlada. Después pasan:

| Prueba | Casos | Qué demuestra |
| --- | ---: | --- |
| Contrato móvil de salud y REST | 10 | Salud negativa o ausente, señales desconocidas/vencidas/duplicadas, SHA distinto, registro parcial y errores HTTP. |
| Transporte real del dashboard | 4 | Errores del ledger/flota, autenticación, recuperación posterior y 112 agentes bajo el límite real de 900 KB. |
| Caché compartida | 3 | 112 lectores comparten una lectura, conservan su hora de observación y pueden recuperarse de un rechazo. |
| Señales de flota | 5 | Presencia no equivale a trabajo; lease/evidencia vencidos y snapshots incompletos no certifican productividad. |

Estas 22 pruebas usan fixtures locales. No representan 112 workers ejecutándose,
un ensayo de carga de producción ni un certificado Android.

Comandos desde la raíz, con Bun disponible:

```sh
bun test backend/__tests__/ivx-dashboard-transport.test.ts
bun test backend/services/ivx-dashboard-read-cache.test.ts backend/services/ivx-fleet-dashboard-signals.test.ts
cd expo
bun test __tests__/autonomous-dashboard-health.test.ts
```

## Pendiente para cerrar la operación 24/7

- Completar los checks del nuevo commit y el certificado móvil que corresponda.
  Un despliegue del backend no actualiza automáticamente el APK instalado.
- Medir la ruta autenticada real: aciertos/fallos de lectura, edad de señales,
  espera de pool y p50/p95/p99. Inspeccionar el plan de la consulta que realmente
  resulte lenta antes de atribuir el problema a un escaneo de 5 GB.
- Verificar 112 agentes individualmente con lease vigente, resultado de
  herramienta y evidencia durable; distinguir registrados, presentes, ejecutando
  y productivos. Un registro completo puede mostrar correctamente cero tareas.
- Completar la ventana de 24 horas con reinicios y fallos controlados, sin
  ejecución duplicada, gasto sin reconciliar ni periodos desconocidos ocultos.
  Los pendientes de runtime, presupuesto y recuperación siguen documentados en
  `docs/autonomous-112-proposed-patch-review-2026-09-13.md`.

Este cambio corrige la lectura y la presentación de evidencia. No declara la
flota certificada ni añade otra implementación del scheduler.
