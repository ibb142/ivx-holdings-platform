#!/usr/bin/env python3
"""Explicit live checks: auth, model download, chat, streaming and Qdrant access.

Run inside the gateway container. The script never writes vector collections or
executes model-suggested tools. It exits nonzero on any failed check.
"""

import json
import os
import signal
import sys
import urllib.error
import urllib.request

GATEWAY = "http://127.0.0.1:4000"
QDRANT = "http://qdrant:6333"
MODEL = "ivx-local-chat"


def request(url, headers=None, payload=None, timeout=15):
    headers = dict(headers or {})
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode("utf-8")
    return urllib.request.urlopen(
        urllib.request.Request(url, data=data, headers=headers), timeout=timeout
    )


def read_json(url, headers=None, payload=None, timeout=15):
    with request(url, headers, payload, timeout) as response:
        return json.load(response)


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def require_denied(url, headers=None):
    try:
        with request(url, headers):
            pass
    except urllib.error.HTTPError as error:
        require(error.code in (401, 403), "Auth check returned HTTP " + str(error.code))
        return
    raise RuntimeError("Endpoint accepted a missing or invalid credential")


def deadline_expired(_signal, _frame):
    raise TimeoutError("Smoke check exceeded its 420-second total deadline")


def main():
    signal.signal(signal.SIGALRM, deadline_expired)
    signal.alarm(420)
    gateway_auth = {"Authorization": "Bearer " + os.environ["LITELLM_MASTER_KEY"]}
    qdrant_auth = {"api-key": os.environ["QDRANT_API_KEY"]}

    require_denied(GATEWAY + "/v1/models")
    require_denied(GATEWAY + "/v1/models", {"Authorization": "Bearer sk-ivx-invalid"})
    require_denied(QDRANT + "/collections")
    require_denied(QDRANT + "/collections", {"api-key": "ivx-invalid"})
    print("PASS: gateway y Qdrant rechazan claves ausentes e incorrectas", flush=True)

    collections = read_json(QDRANT + "/collections", qdrant_auth)
    require(isinstance(collections.get("result", {}).get("collections"), list),
            "Qdrant returned an invalid collection listing")
    print("PASS: Qdrant responde con la clave correcta; memoria IVX aún no migrada", flush=True)

    models = read_json(GATEWAY + "/v1/models", gateway_auth)
    require(any(item.get("id") == MODEL for item in models.get("data", [])),
            "Gateway model alias is missing")
    tags = read_json("http://ollama:11434/api/tags")
    local_model = next((item for item in tags.get("models", [])
                        if item.get("name") == os.environ["OLLAMA_MODEL"]), None)
    require(local_model is not None, "Ollama model has not been downloaded")
    print("PASS: modelo descargado; digest=" + str(local_model.get("digest")), flush=True)

    payload = {"model": MODEL, "messages": [{"role": "user", "content": "Di hola en español."}],
               "max_tokens": 32, "temperature": 0, "stream": False}
    completion = read_json(GATEWAY + "/v1/chat/completions", gateway_auth, payload, 190)
    choices = completion.get("choices", [])
    text = choices[0].get("message", {}).get("content", "") if choices else ""
    require(isinstance(text, str) and bool(text.strip()), "Chat returned no text")
    print("PASS: inferencia de texto completa", flush=True)

    payload["stream"] = True
    fragments = []
    done = False
    with request(GATEWAY + "/v1/chat/completions", gateway_auth, payload, 190) as response:
        for index, raw in enumerate(response):
            require(index < 2048 and len(raw) <= 65536, "Stream exceeded smoke check bounds")
            line = raw.decode("utf-8").strip()
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                done = True
                break
            event = json.loads(data)
            require("error" not in event, "Gateway emitted a streaming error")
            for choice in event.get("choices", []):
                part = choice.get("delta", {}).get("content")
                if isinstance(part, str):
                    fragments.append(part)
    require(done and bool("".join(fragments).strip()), "Stream was empty or incomplete")
    print("PASS: inferencia en streaming completa", flush=True)
    signal.alarm(0)


if __name__ == "__main__":
    try:
        main()
    except (Exception, KeyboardInterrupt) as error:
        # Do not echo provider payloads, model text or credentials.
        print("FAIL: " + type(error).__name__ + "; revisar estado y logs locales", file=sys.stderr)
        sys.exit(1)
