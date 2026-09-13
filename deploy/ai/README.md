# IA local para IVX

Stack de Ollama, LiteLLM y Qdrant con adaptador explícito de chat/streaming en el
backend. Su activación requiere probarlo en el servidor GPU y resolver la tarifa
de admisión del modelo local. Publicar estos archivos no activa el proveedor en
producción ni cambia las reservas financieras o los datos de Supabase.

## Arranque en el servidor GPU

Requiere Linux, Docker Engine con Compose moderno, controladores NVIDIA y NVIDIA
Container Toolkit configurado para Docker. Python 3 se usa para generar claves.
El modelo solicitado `llama3.1:70b` ocupa unos 43 GB solo en pesos Q4_K_M; contexto,
ejecución, imágenes y volúmenes necesitan espacio y memoria adicionales. Confirmar
VRAM, RAM y disco disponibles en el servidor antes de descargarlo. El tamaño de
los pesos no es una garantía de que una GPU con esa VRAM pueda ejecutarlo.

Desde esta carpeta:

```bash
bash start.sh
docker compose exec -T litellm python /app/ivx-smoke.py
```

`start.sh` comprueba Docker y NVIDIA, genera claves, valida Compose y arranca los
servicios. Para seguir la descarga, usar `docker compose logs -f model-init` una
sola vez; Ctrl+C deja de seguir los logs y no detiene el contenedor. `model-init`
es el nombre del servicio Compose, no un nombre fijo de contenedor para
`docker logs`. La salida de logs que muestra `start.sh` es finita.

La primera descarga puede tardar. LiteLLM espera a que Ollama esté saludable y a
que `model-init` termine correctamente. Su healthcheck solo comprueba que el
proceso responde; `smoke.py` comprueba autenticación, modelo presente, acceso a
Qdrant e inferencia real tanto normal como en streaming. Ejecutarlo cuando el
gateway esté saludable. No certifica herramientas, carga de 12 agentes o memoria
de la aplicación. Las pruebas de inferencia tienen un límite total de 420 segundos.

`prepare.py` crea `.env` con permisos 0600, no muestra claves y no sobrescribe un
archivo existente. `.env` está excluido por el `.gitignore` del repositorio. No
compartir la salida completa de `docker compose config`: puede mostrar las claves.
La clave generada de LiteLLM también se guarda como `OPENAI_API_KEY` para el
backend. Si ya existe un `.env` de la versión anterior, agregar las variables
de backend indicadas abajo y usar su clave local existente; el generador no lo
reescribe. Las contraseñas ilustrativas compartidas en el chat no se instalan.

## Endpoints

| Consumidor | URL | Autenticación |
| --- | --- | --- |
| Cliente en el propio servidor | `http://127.0.0.1:4000/v1` | Bearer `LITELLM_MASTER_KEY` |
| Cliente dentro de la red Compose | `http://litellm:4000/v1` | Bearer `LITELLM_MASTER_KEY` |
| Cliente de vectores dentro de Compose | `http://qdrant:6333` | Cabecera `api-key: QDRANT_API_KEY` |

El alias del modelo de chat es `ivx-local-chat`. Ollama y Qdrant no publican
puertos en el host; el gateway escucha en loopback. Para conectar el backend de
Render hace falta una ruta privada autenticada o un endpoint HTTPS con TLS y
restricción de acceso. `localhost` en Render no llega a este servidor.

Las imágenes usan versiones concretas observadas el 2026-09-13: Ollama 0.34.0,
Qdrant 1.19.1 y LiteLLM 1.100.1. Son etiquetas de versión, no digests inmutables.
La disponibilidad de las imágenes y su arranque deben verificarse en el host.
El digest del modelo descargado aparece en la prueba para registrar qué se probó.

Validación realizada: `config --quiet` con Compose 5.5.1, rechazo de claves
ausentes, sintaxis YAML/Python y generación de claves con permisos 0600 sin
sobrescritura y con la clave del backend sincronizada. Pasaron 61 pruebas del
adaptador y regresión, y el typecheck del backend. El arranque con `start.sh`
se intentó y rechazó explícitamente la ausencia de Docker. No se arrancaron
contenedores: el entorno de preparación carece de
Docker Engine y GPU. Las consultas a los registros de imágenes agotaron su tiempo
de espera; tampoco se verificó una descarga de imágenes desde este entorno.

## Selección del proveedor en IVX

Estas variables se cargan en el **proceso del backend**, además de arrancar
Compose. El `.env` que genera `prepare.py` ya las incluye con la clave aleatoria:

```dotenv
IVX_AI_PROVIDER=litellm
IVX_AI_MODEL=ivx-local-chat
OPENAI_API_BASE=http://127.0.0.1:4000/v1
OPENAI_API_KEY=<mismo valor local de LITELLM_MASTER_KEY>
```

`IVX_AI_PROVIDER=litellm` selecciona el adaptador `createOpenAI(...).chat(...)`
en ambas rutas del SDK. Las claves antiguas de owner/Vercel no sustituyen la clave
local. El gateway no usa `/responses`, no sigue redirecciones y sus errores no
activan el fallback de pago. La telemetría identifica el proveedor como `litellm`.
Los modelos explícitos que envíen otros módulos o clientes deben existir como
alias en LiteLLM; un alias desconocido falla, no se transforma en otro modelo.

El chat de owner selecciona el modelo local cuando este modo está activo. Assistant
y Plan Creator usan el modelo configurado si el cliente no solicita otro. Los
adjuntos se rechazan en este piloto de texto antes de enviar la solicitud.

Dentro de la red Compose, usar `http://litellm:4000/v1`. Desde Render, usar la URL
HTTPS o ruta privada del servidor GPU; no usar `localhost`. Quitar el selector
`IVX_AI_PROVIDER=litellm` permite volver a la selección anterior tras restaurar
las variables del proveedor anterior.

## Integraciones pendientes

Inspección del código base `9ad722d023823a18f1796f70b52dcf4be1cc05e7`:

1. El adaptador está comprobado con el SDK real y un servidor HTTP local de prueba:
   destino, clave, respuesta, streaming, rechazo 401, cancelación, redirecciones y
   ausencia de fallback de pago. Falta verificar inferencia con Ollama/Llama en
   GPU, rendimiento y conversación real de owner en el despliegue destino.
2. `backend/services/operational-memory/vector-memory.ts` persiste en Supabase
   pgvector. Qdrant no consume automáticamente esa memoria. Se necesita un
   adaptador, autorización por propietario, migración verificable y recuperación.
3. `embeddings.ts` usa `text-embedding-3-small` y la memoria define 1536 dimensiones.
   Este stack no configura embeddings. Elegir un modelo local exige ajustar el
   esquema y volver a generar los vectores; no mezclar dimensiones o espacios
   de modelos diferentes.
4. Llama 3.1 es el modelo de texto solicitado. Las rutas de imágenes, audio y PDF
   necesitan sus propios modelos o un proveedor compatible. No renombrar el
   modelo local como `gpt-4o` para ocultar esta diferencia.
5. El límite de orquestación de 12 agentes es independiente de la capacidad GPU.
   El piloto empieza con una inferencia paralela, contexto 8192 y cola Ollama de
   8 solicitudes. Medir memoria, latencia y rechazos antes de aumentar
   `IVX_LOCAL_CONCURRENCY`; no equivale a un límite distribuido del backend.
6. LiteLLM funciona aquí sin base de datos propia: no aplica un presupuesto
   monetario persistente. Conservar el control de admisión y la contabilidad de
   IVX, e incorporar el coste del servidor. No marcar cargos inciertos como
   conciliados por haber instalado este stack.
   **Bloqueo de activación:** el control global actual cotiza con el catálogo
   de Vercel y no tiene una tarifa verificada para `ivx-local-chat`. El adaptador
   conserva ese control y la solicitud será rechazada si no tiene cotización.
   Hace falta incorporar una política de coste/concurrencia del servidor local;
   este cambio no desactiva el control ni inventa un coste cero.

## Operación y retirada

```bash
docker compose logs --tail=100 ollama litellm qdrant
docker compose stop
```

Los volúmenes conservan modelos y vectores al detener servicios. Antes de almacenar
memoria real, preparar backups y ensayar restauración. Este piloto no incluye un
cambio automático del proveedor de producción ni un fallback a proveedores pagos.

## Referencias oficiales

- [Ollama en Docker](https://docs.ollama.com/docker)
- [Llama 3.1 70B: tamaño y cuantización](https://ollama.com/library/llama3.1:70b)
- [Reservas GPU en Docker Compose](https://docs.docker.com/compose/how-tos/gpu-support/)
- [LiteLLM con Ollama y ollama_chat](https://docs.litellm.ai/docs/providers/ollama)
- [LiteLLM sin base de datos y límites de presupuesto](https://docs.litellm.ai/docs/proxy/docker_quick_start)
- [Claves de API de Qdrant](https://qdrant.tech/documentation/security/)
