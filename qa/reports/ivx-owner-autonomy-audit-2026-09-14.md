# IVX IA: auditoría de chat, Autonomous y Senior Developer

Auditoría del 14 de septiembre de 2026 sobre `main` en
`97c472982f3c67b797e5a5f2c024c1b7060794cc`. Este documento describe un parche, pruebas locales y evidencia de CI y Supabase. No constituye una certificación de producción ni «11/11 Green».

## Evidencia observada

- Las capturas muestran HTTP 503 en `/api/ivx/owner-ai`, un resultado original
  `FAILED`, el checkpoint `ORIGINAL_RESPONSE_RECONCILED`, una respuesta sin texto
  presentada como «Not sent» y el indicador «Assistant ready».
- A las 18:19 UTC, `/health/ready` devolvió 503 mientras `/health` y `/version`
  respondían 200 con el SHA anterior. No se conservó el cuerpo de esa primera
  respuesta 503; no permite atribuir el fallo a una dependencia concreta.
- A las 18:20 UTC, readiness respondió 200 y observó dos workers remotos con
  heartbeat reciente. A las 18:43 UTC volvió a responder 200, con AI, database,
  auth y queue en estado `ok`. La disponibilidad observada es intermitente.
- El GET público de `/api/ivx/owner-ai` ofrece metadatos estáticos. No ejecuta una
  conversación autenticada ni demuestra que el proveedor pueda responder.
- La interfaz web abre correctamente la pantalla de acceso. No había una sesión
  de owner autenticada en el navegador de auditoría; no se ejecutó una misión real.
- [El monitor 360 del mismo SHA](https://github.com/ibb142/ivx-holdings-platform/actions/runs/34868526414)
  registró HTTP 500 en el control plane y falló al despachar recuperación. Su
  comprobación de registro encontró 112 identidades únicas. Ese registro no prueba
  112 agentes ejecutando trabajo simultáneamente.

## Causa confirmada en los recibos de producción

Se consultaron, en modo de solo lectura, los dos request IDs visibles en las
capturas. Ambos recibos de `ivx_durable_documents` terminaron con HTTP 503 a las
16:20:07 y 16:34:18 UTC. El diagnóstico persistido fue exactamente:

`Global AI budget: durable admission unavailable`

El fallo procede de la confirmación durable de admisión al presupuesto global.
El catch lo convirtió en un error genérico de generación/persistencia, y el
cliente lo atribuyó a calentamiento. El log anterior descartaba la excepción
original: todavía falta determinar si el transporte subyacente sufrió timeout,
pérdida de conexión u otro error. No se afirma que una reserva se confirmara en
estos dos intentos ni que el proveedor recibiera sus solicitudes.

A las 19:01–19:05 UTC se verificó que existen las funciones y tablas de presupuesto,
la política está activa y su estado consultado no estaba agotado. Había dos
solicitudes activas y reservas de coste incierto que requieren su reconciliación
normal; no se liberaron ni se alteró la política. `max_connections` es 60 y la
muestra de conexiones no estaba saturada. Esto no descarta saturación anterior.

La tarea `task_framework_patch_block_18_final` **sí existe**. Su `task_id` coincide
con `payload.taskId`; la lectura de esta auditoría encontró `QUEUED`, sin SHA ni
deployment ID registrados. El comando de estado debe informar ese registro.

## Fallos confirmados y correcciones

| Prioridad | Fallo del código existente | Cambio verificable |
| --- | --- | --- |
| Alta | Un error de transporte al reservar presupuesto se convierte inmediatamente en un 503 genérico, incluso si la transacción pudo confirmarse. | Reintentos limitados con backoff y el mismo UUID; lectura exacta de reserva, identidad de worker, petición, importe, catálogo, vigencia y revisión de política. Sin confirmación no se llama al proveedor. No se cambian límites ni se reintentan denegaciones de política. |
| Alta | El catch de conversación/manual pierde el diagnóstico de admisión y su estado de ejecución. | Respuesta estructurada con código, causa segura, ID original y estado de solicitud al proveedor; compatibilidad con recibos antiguos. |
| Alta | Una copia parcial de streaming del espejo local puede sustituir el texto completo durante la deduplicación, ocultándolo también en búsqueda. | El mensaje vivo prevalece por ID sobre su copia parcial. Los deltas aún activos quedan fuera del espejo durable. Regresión ejecutada sobre los selectores reales de la pantalla. |
| Media | El cursor sigue animándose después de retirarse la vista nativa al terminar streaming. | El bucle se limita al cursor activo y ambas animaciones se detienen al desmontarse. |
| Alta | Peticiones que contienen «audit/test» y «senior developer» pueden ser interceptadas por una llamada a `/health`, presentada como prueba de capacidad. | Se elimina el atajo. La petición exacta del incidente alcanza el router `DEVELOPER_WORKER`. La ejecución posterior mantiene sus controles existentes. |
| Alta | `/status --task="…"` no está registrado y puede ir al modelo de conversación. | Consulta determinista del registro PostgreSQL de tareas y del registro de trabajos Senior Developer. Respuesta visible y persistida; no inicia trabajo. Valida que el ID solicitado coincida con `payload.taskId`. |
| Alta | El catch general devuelve errores como HTTP 200 y genera otro request ID. | Conserva el estado HTTP válido, el código de error y el ID original. El error ya no parece una respuesta exitosa a transportes y monitores. |
| Alta | La «auto-recovery» de la app solo consulta la respuesta original, pero anuncia reparación, persistencia del mensaje y acciones de retry/cancel. | Se distingue resultado confirmado, fallo y resultado desconocido. La consulta no se presenta como reparación ni como nueva ejecución. |
| Media | La reconciliación sustituye el diagnóstico original por un error genérico. | Devuelve HTTP original, código, mensaje, request ID y trace disponibles. JSON inválido o nulo se muestra como fallo. |
| Media | Retry/cancel de `owner-request:…` se dirige al registro de otra cola. | Respuesta 409 explícita con capacidades deshabilitadas; ninguna mutación de esa cola. |
| Media | La app vuelve a consultar incluso cuando intake ya devuelve una respuesta terminal. | Usa el resultado confirmado inmediatamente y conserva el ID de la respuesta guardada. |
| Media | Una consulta fallida antes de obtener task ID pierde la referencia para reabrir. | Guarda primero la identidad original localmente; no afirma que el servidor guardó el mensaje. Limita la consulta y lectura del cuerpo a 12 segundos. |
| Media | Mensajes vacíos en streaming o cuerpos inválidos se confunden con mensajes salientes fallidos; el propio logging puede fallar al llamar `.slice` sobre un objeto. | Respeta el estado de streaming, normaliza el texto antes del logging y ofrece refrescar la conversación para respuestas guardadas ilegibles. |
| Media | El pie indica «Assistant ready» aun con conexión fallida; todo 5xx se atribuye a calentamiento. | Representa conexión sin verificar, disponible o fallida y conserva el diagnóstico observado sin inferir un cold start. |

## QA ejecutado

Dependencias instaladas desde los dos lockfiles, sin modificar versiones.
Runtime local: Bun 1.4.2; el nuevo workflow fija Bun 1.3.9 para CI.

| Verificación | Resultado local |
| --- | --- |
| TypeScript completo de backend | Aprobado |
| TypeScript completo de Expo | Aprobado, con heap de 4 GiB |
| Admisión, ID estable, pérdida de acknowledgements, carreras de historial y rutas | 91 tests aprobados, incluyendo persistencia y ramas reales de error |
| API de reconciliación, autenticación, errores y acciones no compatibles | 9 tests aprobados |
| Wrapper de la suite SSE en proceso aislado | Aprobado: admisión, replay, cancelación y autorización |
| Envíos del cliente y presentación de errores | 19 tests aprobados, incluyendo la carrera del espejo local |
| Transporte de reconciliación con fallos inyectados | 4 tests aprobados |
| Presupuesto: admisión, costes, transporte y diagnóstico | 60 tests aprobados |
| `git diff --check` | Aprobado |

El test de la entrada de producción ejecuta la función real con I/O sustituido:
comprueba `/status`, persistencia de ambos mensajes, rechazo de argumentos
incorrectos y llegada de la petición de auditoría al router. El caso de auditoría
detiene el flujo en la lectura de tablas: no certifica una ejecución real del
worker. Los tests de concurrencia verifican las fronteras de admisión; no son una
prueba de carga entre réplicas reales de Render.

Se añade `IVX Owner Chat Recovery Gate` para ejecutar estas regresiones y ambos
typechecks en PRs y cambios de main. El gate aislado de backend existente continúa
siendo aplicable. En el primer commit del PR (`d22f831`), el
[gate aislado](https://github.com/ibb142/ivx-holdings-platform/actions/runs/34884015451)
aprobó los **403 archivos de pruebas descubiertos**; también aprobaron el nuevo
gate de recuperación y el test con proveedor real. Esos resultados no certifican
los cambios posteriores de presupuesto y espejo, que necesitan su propia CI.

El [certificado Android](https://github.com/ibb142/ivx-holdings-platform/actions/runs/34884015370)
aprobó login, dashboard y señales de Autonomous, pero falló al mostrar la respuesta
del chat. Se correlacionó su marcador único con el recibo HTTP 200 y la fila real
de `ivx_messages`: texto correcto, rol assistant y persistencia confirmada. El
logcat registra el render del texto completo y su posterior desaparición; la
captura final muestra solo el mensaje owner en búsqueda. También registra una
animación dirigida a una vista ya desmontada. Esta evidencia motivó el arreglo
del espejo y del ciclo de vida del cursor, sin relajar la aserción Android.

El [gate Landing 19](https://github.com/ibb142/ivx-holdings-platform/actions/runs/34884015433)
falló en cuatro pruebas de reels: el feed externo respondió `unavailable` y el
estado `failed` no cumplió la expectativa `ready`. No se modificaron ni omitieron
esas pruebas. La certificación general sigue pendiente mientras haya gates rojos.

## Integración y evidencia pendiente

1. Leer logs autenticados del API y workers de Render en las horas de los fallos,
   correlacionando request ID, auth, lectura del registro, proveedor y handoff.
   El conector disponible exige confirmar el workspace antes de seleccionar uno.
2. Correlacionar el fallo de admisión de presupuesto con el error concreto del
   transporte en Render. Verificar la recuperación bajo concurrencia real sin
   cambiar límites monetarios, conexiones o réplicas sin evidencia.
3. Revisar CI del commit del PR y seguir los controles de merge/despliegue del
   owner. El parche requiere publicar backend y app; los clientes Android
   instalados requieren la actualización correspondiente para los cambios de UI.
4. Con sesión owner, ejecutar una consulta `/status` y una misión controlada:
   tarea → worker → parche → QA → PR → despliegue autorizado. Adjuntar task ID,
   SHA, checks y deployment ID reales.

No se aplicaron migraciones, cambios de secretos, redimensionamientos de pools,
activación de la flota ni despliegues de producción durante esta auditoría.
