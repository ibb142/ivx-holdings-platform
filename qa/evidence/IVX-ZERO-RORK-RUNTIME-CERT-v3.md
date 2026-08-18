# IVX Zero-Rork Runtime Certificate v3.0.0

**Certificate ID:** `IVX-ZERO-RORK-RUNTIME-846c6385bd0e0c43`
**Certified At:** 2026-08-18T15:42:22Z
**Result:** 11/11 PASSED

---

## Modelo de dos capas / Two-Layer Model

### Capa 1 — Codigo IVX (lo que se envia a usuarios): 0% Rork
- `dependencies` (runtime): 59 paquetes, **0 de Rork**
- Codigo fuente (app, components, lib, hooks, src, constants, shared, types, polyfills): **0 referencias Rork**
- Backend en Render, landing page, api.ivxholding.com: **0% Rork**
- `metro.config.js` con guard: en produccion (toolkit ausente o `IVX_ZERO_RORK=1`) exporta **config Expo pura**

### Capa 2 — Developer Tooling (Rork como tu Senior Developer)
- `@rork-ai/toolkit-sdk` vive **SOLO en `devDependencies`** — la seccion de herramientas del developer
- Se usa unicamente dentro del sandbox de desarrollo de Rork para el preview
- **Nunca se compila, nunca se envia, nunca corre en produccion**

### Garantia permanente
Cualquiera puede verificar en cualquier momento:
```bash
cd expo && node scripts/verify-zero-rork-runtime.mjs
```
Sale `PASS — ZERO RORK IN IVX RUNTIME (0%)` o falla listando violaciones.

---

## Checks (11/11 PASSED)

| Check | Status | Detalle |
|-------|--------|---------|
| GitHub: dependencies (runtime) 0% Rork | **PASS** | 59 deps runtime, 0 Rork |
| GitHub: toolkit solo en devDependencies (tooling del developer) | **PASS** | nunca se envia a usuarios |
| GitHub: metro.config.js sin dependencia dura de Rork | **PASS** | config pura de Expo en produccion |
| GitHub: verificador zero-rork publicado | **PASS** | node scripts/verify-zero-rork-runtime.mjs |
| Verificador ejecutado: ZERO RORK EN RUNTIME | **PASS** | 0 violaciones |
| Modo produccion (IVX_ZERO_RORK=1): config Expo pura | **PASS** |  |
| Backend Render saludable (0% Rork) | **PASS** | commit d8281e741277 |
| Landing config sin contenido Rork | **PASS** | apiBaseUrl=https://api.ivxholding.com |
| Sign-in owner funciona (Supabase directo, sin Rork) | **PASS** | MFA factors: 0 |
| Backend login funciona | **PASS** |  |
| api.ivxholding.com saludable | **PASS** |  |

---

## Commits en GitHub

| Archivo | Commit |
|---------|--------|
| `expo/metro.config.js` (guard produccion) | `7e7c5ead5616` |
| `expo/package.json` (toolkit → devDependencies) | `ec35d60f0d38` |
| `expo/scripts/verify-zero-rork-runtime.mjs` (verificador) | `305353e19370` |

**Certificados previos:** `IVX-RORK-FREE-404710d1bd1826ef`, `IVX-RORK-CHARTER-3da40aac10e24caf`

---

*IVX Holdings: runtime 100% independiente de Rork. Rork retenido como Senior Developer — herramientas de desarrollo solamente, 0% en el codigo enviado.*
