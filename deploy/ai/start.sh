#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

if ! command -v docker >/dev/null 2>&1; then
  echo "No se puede arrancar: falta Docker Engine/CLI en este host." >&2
  exit 1
fi
docker info >/dev/null
docker compose version >/dev/null
if ! command -v nvidia-smi >/dev/null 2>&1; then
  echo "No se puede arrancar: falta una GPU NVIDIA con su controlador." >&2
  exit 1
fi
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
python3 prepare.py
docker compose config --quiet
docker compose up -d
docker compose ps -a
docker compose logs --tail=40 model-init
echo "Cuando LiteLLM esté saludable: docker compose exec -T litellm python /app/ivx-smoke.py"
