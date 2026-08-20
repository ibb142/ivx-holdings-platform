# Auditoría de dependencia con Rork — 2026-08-20

Alcance: determinar qué hace Rork en este proyecto, en particular si es Rork quien
publica los deploys en el GitHub del owner, y retirar la dependencia del producto.

---

## 1. Cómo llega el código a tu GitHub

El remote local **no apunta a GitHub**:

```
origin  https://git:e2b-egress-managed@rork-git-router.rork-direct.workers.dev/git/j2l8t44588ix9ns7b57mu
```

Todo pasa por el router de Rork. Los 12 commits más recientes están firmados por
`Rork Agent <agent@rork.app>`. El repo real es `ibb142/ivx-holdings-platform`.

**Hallazgo crítico:** los commits de Rork Agent **sí modifican `.github/workflows/`**
(`4e3cdddf6`, `5b6083ab5`, `3d5c60825`, `54d0850bd`, `63a1efa70`, `149437179`).
El PAT del owner tiene scope `repo` únicamente y **no puede** hacerlo.

> El router de Rork tiene más permisos sobre el GitHub del owner que el propio owner.
> Si Rork sale, se pierde la capacidad de publicar cambios de workflow hasta que
> exista un PAT propio con scope `workflow`.

## 2. Corrección a un diagnóstico previo

Se reportó antes que los workflows estaban bloqueados por falta de scope `workflow`.
**Era incorrecto.** Verificado por ejecución: un dispatch de `ivx-ci.yml` con el PAT
de scope `repo` devolvió `HTTP 204` y creó el run real **#1356**. El scope `workflow`
solo hace falta para *editar* los YAML, no para *ejecutarlos*.

## 3. La independencia de Rork estaba revertida

`expo/metro.config.js` volvía a contener:

```js
const { withRorkMetro } = require("@rork-ai/toolkit-sdk/metro");
module.exports = withRorkMetro(config);
```

Con `@rork-ai/toolkit-sdk` **ausente de `node_modules` y del lockfile**. Es una
dependencia dura de build: ninguna máquina podía generar APK, AAB ni bundle web.
El propio test `expo/__tests__/vendor-independence.test.ts` documenta que la
remoción ya había sido revertida **dos veces** por sincronización externa.

Estado al iniciar: **4 de 12 gates fallando**.

## 4. Fuga de credenciales: causa raíz

- Un token GitHub vivo aparecía en **texto plano en 55 archivos** bajo `.rork/history/main/*.json`.
- Esos **272 archivos estaban trackeados en git**. `.gitignore` sí lista `.rork`,
  pero **gitignore no aplica a archivos ya trackeados** — la regla se añadió después
  del commit inicial.
- El job `Secret scan` del CI buscaba `ghp_[A-Za-z0-9]{36}` **solo en
  `*.ts, *.tsx, *.js, *.mjs`**. No escaneaba `.json`. Por eso reportaba verde con un
  token vivo dentro del repo.
- El repo `ibb142/ivx-holdings-platform` es **público**. `.rork/` devolvió 404, así que
  no se había publicado todavía, pero estaba listo para subir en el siguiente push.

Segundo token distinto hallado en `expo/.env` (`RORK_PUBLIC_GITHUB_TOKEN`): **muerto (401)**.

## 5. Acciones ejecutadas

| Acción | Estado |
|---|---|
| `.rork/` fuera del índice de git (272 archivos, siguen en disco) | hecho |
| `expo/metro.config.js` restaurado a config Expo autocontenida | hecho |
| `@rork-ai/toolkit-sdk` eliminado de `expo/package.json` + lockfile | hecho |
| 8 claves de vendor eliminadas de `expo/.env` | hecho |
| `Secret scan` del CI ahora escanea **todo archivo trackeado** | hecho |
| Scan imprime **solo nombres de archivo**, no el secreto | hecho |

Prueba del guardia nuevo, sobre el `.json` real que contenía el token:
scan viejo detecta **0**, scan nuevo detecta **1**.

## 6. Verificación

- `vendor-independence.test.ts`: **12 pass / 0 fail** (antes 8/4)
- Secret scan sobre archivos trackeados: **EXIT=0**, sin fugas
- Suite backend: **57 fail / 22 errores antes y después** — sin regresiones
- `runChecks(expo)`: **passed**, 0 errores TS, 0 de lint
- Residuos de vendor: `metro.config` 0 · `package.json` 0 · `.env` 0 · `.rork` trackeado 0

### Corrección de una cifra previa

Un registro anterior afirmaba «+9 pass, −4 fail, 4 fallos preexistentes reparados».
**Retractado.** Re-medido dos veces en esta sesión, con `.env` original y con `.env`
limpio: **57 fail antes y 57 fail después**. El cambio del Block 1 añade 5 tests que
pasan y no repara ninguno. La cifra venía de otra sesión y no debió darse por buena
sin re-verificar.

## 7. Lo que NO se tocó, y por qué

- **`rork.json` y el remote del router**: son el arnés del workspace y la vía por la
  que hoy llegan los deploys a GitHub. Retirarlos ahora deja al proyecto **sin
  mecanismo de publicación** hasta que exista un PAT propio con `repo` + `workflow`.
- **Versión del landing (`1.10.14` vs `1.10.28`)**: el check de consistencia falla de
  verdad. No se ajustó el número porque las URLs de descarga sirven **HTML, no APK**
  (`3c 21 44 4f 43` = `<!DOCTYPE`). Cambiar el string pondría el check en verde con el
  enlace igual de roto.

## 8. Pendiente del owner

1. **Rotar el token expuesto** (estuvo en 55 archivos y en el chat). Scope `repo` sobre 23 repos.
2. **Emitir un PAT con `repo` + `workflow`** para dejar de depender del router de Rork
   para publicar workflows.
3. **Reparar las descargas del landing** — hoy no sirven APK.
