# IA local para IVX

Stack separado de Ollama, LiteLLM y Qdrant. Prepara un piloto de inferencia local;
todavía requiere conectar el backend y probarlo en el servidor GPU. No modifica
el proveedor activo, las reservas financieras ni los datos de Supabase.

## Arranque en el servidor GPU

Requiere Linux, Docker Engine con Compose moderno, controladores NVIDIA y NVIDIA
Container Toolkit configurado para Docker. Python 3 se usa para generar claves.
El modelo solicitado `llama3.1:70b` ocupa unos 43 GB solo en pesos Q4_K_M; contexto,
ejecución, imágenes y volúmenes necesitan espacio y memoria adicionales. Confirmar
VRAM, RAM y disco disponibles en el servidor antes de descargarlo. El tamaño de
los pesos no es una garantía de que una GPU con esa VRAM pueda ejecutarlo.

Desde esta carpeta:

```bash
docker info
docker compose version
nvidia-smi
python3 prepare.py
docker compose config --quiet
docker compose up -d
docker compose ps -a
docker compose logs --tail=40 model-init
docker compose exec -T litellm python /app/ivx-smoke.py
```

La primera descarga puede tardar. LiteLLM espera a que Ollama esté saludable y a
que `model-init` termine correctamente. Su healthcheck solo comprueba que el
proceso responde; `smoke.py` comprueba autenticación, modelo presente, acceso a
Qdrant e inferencia real tanto normal como en streaming. Ejecutarlo cuando el
gateway esté saludable. No certifica herramientas, carga de 12 agentes o memoria
de la aplicación. Las pruebas de inferencia tienen un límite total de 420 segundos.

`prepare.py` crea `.env` con permisos 0600, no muestra claves y no sobrescribe un
archivo existente. `.env` está excluido por el `.gitignore` del repositorio. No
compartir la salida completa de `docker compose config`: puede mostrar las claves.

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
sobrescritura. No se arrancaron contenedores: el entorno de preparación carece de
Docker Engine y GPU. Las consultas a los registros de imágenes agotaron su tiempo
de espera; tampoco se verificó una descarga de imágenes desde este entorno.

## Conexión pendiente con IVX

Inspección del código base `9ad722d023823a18f1796f70b52dcf4be1cc05e7`:

1. `backend/ivx-ai-runtime.ts` pasa un nombre de modelo a `generateText` y
   `streamText`. Esa ruta usa el proveedor predeterminado del SDK; cambiar solo
   `IVX_AI_GATEWAY_URL` no conecta estas llamadas a LiteLLM. Se necesita un
   adaptador OpenAI-compatible explícito para chat y streaming, con timeout,
   cancelación, selección de modelo y telemetría correctos.
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
