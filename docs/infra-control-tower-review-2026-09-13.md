# Control tower: diagnóstico verificado y recuperación no certificada

Fecha: 2026-09-13. Proyecto confirmado: `kvclcdjmjghndxsngfzb`.
Referencia aportada: `d1f6518` (PR #1868, aún sin integrar).
La herramienta se prepara sobre `594f6129`; los módulos de conexión y protección
terminal utilizados no cambian entre esas dos referencias.

## Resultado de la revisión

El script recibido no es una recuperación segura de sesiones huérfanas. En una
lectura preliminar real, su predicado seleccionó **17 sesiones administradas**:

| Servicio / identidad observada | Sesiones seleccionadas |
| --- | ---: |
| PostgREST, usuario `authenticator` | 7 |
| Supavisor, incluidos `auth_query` y usuario `pgbouncer` | 3 |
| Realtime, usuario `supabase_admin` | 6 |
| `supabase_admin` con application_name vacío | 1 |

Son objetivos del predicado, no sesiones terminadas ni fugas demostradas. La
lectura no autoriza afirmar que cerrar esas conexiones recupere memoria o la flota.
`idle` significa esperar un comando del cliente, no una conexión zombi.
[PostgreSQL 17: pg_stat_activity](https://www.postgresql.org/docs/17/monitoring-stats.html#MONITORING-PG-STAT-ACTIVITY-VIEW).

## Defectos del script recibido

| Defecto | Efecto |
| --- | --- |
| Excluir `%supabase%` y `%pooler%` solo en application_name | No excluye `Supavisor`, PostgREST, Realtime ni nombres vacíos; la lectura real lo confirmó. |
| Sin filtro positivo de propietario, base, edad o proceso retirado | Puede seleccionar sesiones de otros componentes. Un backend idle también puede recibir trabajo antes de que llegue la señal. |
| `count(pg_terminate_backend(pid))` | Cuenta valores no nulos, incluidos `false`, no terminaciones confirmadas. |
| `pg_terminate_backend(pid)` sin espera | Un `true` acredita envío de señal, no salida confirmada del proceso. Un error posterior tampoco deshace señales ya enviadas. |
| `psql ... || echo FAILED` dentro de una captura de stdout | Absorbe el fallo. Si stdout contiene también `SET`, comparar toda la cadena con `FAILED` puede imprimir éxito. |
| Mensaje final de 0% errores | Puede aparecer después de una purga fallida absorbida. No mide salud del runtime, memoria ni recuperación. |
| `count(*) as total_active` sobre pg_stat_activity | Mezcla procesos y estados; no es el número de conexiones cliente activas ni distingue base actual de todo el clúster. |
| `FAILED -> QUEUED` directo | El motor incluye FAILED en TERMINAL_STATES y rechaza reaperturas hacia estados no terminales. El SQL elude ese contrato. |
| Aumentar version | Protege un orden de revisiones; no evita repetir llamadas a proveedores, escrituras o despliegues ya realizados. |
| Diez tareas sin ORDER BY ni run/mission explícito | Selección arbitraria del historial, sin revisar evidencia, presupuesto ni motivo del fallo. |
| Actualización parcial de columnas/payload | Deja fechas y otros campos de lease/finalización incoherentes. COALESCE no convierte JSON null o un escalar en un objeto válido. |
| SHA impreso como literal | No verifica ni el checkout real ni el commit de API/worker desplegados. |

Semántica de retornos: [PostgreSQL 17: administración de sesiones](https://www.postgresql.org/docs/17/functions-admin.html#FUNCTIONS-ADMIN-SIGNAL)
y [agregados](https://www.postgresql.org/docs/17/functions-aggregate.html).
Para psql, `-X`, `-w`, límites de conexión y `ON_ERROR_STOP` explícito ayudan a
hacer reproducible un runner; esta corrección utiliza el cliente PG del proyecto.
[PostgreSQL 17: psql](https://www.postgresql.org/docs/17/app-psql.html).

## Implementación preparada

- `scripts/ops/infra-control-tower.sh`: launcher ejecutable que propaga el exit code.
- `scripts/ops/infra-control-tower.ts`: una conexión con TLS verificado, validación
  del mismo proyecto, `BEGIN READ ONLY`, timeout del servidor de 4.5 s, lock de
  1 s y cliente de 5.5 s. No exporta una URL alternativa sobre el entorno del owner.
- Consulta conexiones por alcance y muestra cuáles coincidirían con la purga.
  Declara si el rol tiene acceso a todas las estadísticas; visibilidad parcial
  no demuestra que las sesiones ocultas estén sanas o ausentes.
- Muestra hasta diez tareas FAILED, ordenadas y con indicador de muestra truncada.
  Preserva versiones bigint como texto y señala lease activo, evidencia, payload
  inconsistente o revisión terminal. No cambia tareas ni consulta/liquida presupuesto.
- Emite `DIAGNOSTIC_COMPLETE` únicamente para lecturas completas; mantiene
  `recoveryCertified:false`. Si falla, emite `DIAGNOSTIC_UNAVAILABLE` y exit 1.
- Declara el commit del checkout y `productionCommitVerified:false`; no lo
  presenta como SHA del servicio desplegado.

Uso con Bun, dependencias y variables del proyecto configuradas:

```sh
./scripts/ops/infra-control-tower.sh
```

## QA y ejecución de esta sesión

1. Bash syntax: PASS. Permiso de ejecución aplicado.
2. TypeScript del runner, sus pruebas y dependencias: PASS; backend typecheck: PASS.
3. Seis pruebas del contrato: PASS. Incluyen fallo de lectura, resultado parcial,
   timestamp inválido y rechazo de una URL preferida que pertenece a otro proyecto.
4. PostgreSQL aislado/PGlite: ambas consultas se ejecutan; siete comprobaciones
   verifican clasificación, lease activo, JSON null, bigint, ausencia de cambios
   y límite de muestra. Esto prueba el SQL, no disponibilidad de producción.
5. Launcher ejecutado localmente: exit 1, configuración no disponible. Este
   entorno no contiene una URL de BD; no se inventaron ni solicitaron secretos.
6. Conector autorizado: la lectura preliminar identificó las 17 sesiones. La
   consulta completa de conexiones venció con `57014`; la consulta de tareas
   falló con `Connection terminated due to connection timeout`. No se repitieron
   mutaciones ni se presentaron listas vacías como resultados confirmados.

**Mutaciones realizadas: 0. Sesiones terminadas: 0. Tareas reencoladas: 0.**
La causa de los timeouts y los objetivos recuperables siguen sin confirmación.
Antes de intervenir hay que obtener una lectura válida y revisar las identidades,
leases, evidencia y obligaciones de presupuesto de los objetivos concretos.

## Estado del PR #1868

Diez de once workflows aprobaron. El workflow Android aprobó login/home,
dashboard y señales independientes; falló el certificado de chat al esperar
el token único en un mensaje del asistente. La captura muestra el mensaje del
owner, pero no una respuesta coincidente. Esto no se debe tratar como chat terminado.
[Run del certificado Android](https://github.com/ibb142/ivx-holdings-platform/actions/runs/34782211336).

El PR permanece sin integrar/desplegar bajo la regla del owner de checks aprobados.
Esta herramienta de diagnóstico no sustituye esa prueba ni certifica 112 IA / 24 h.
