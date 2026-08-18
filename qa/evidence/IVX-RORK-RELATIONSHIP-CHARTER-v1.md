# IVX-Rork Relationship Charter v1.0.0

**Certified At:** 2026-08-18T13:24:15Z  
**Certificate ID:** `IVX-RORK-CHARTER-3da40aac10e24caf`  
**Previous Independence Certificate:** `IVX-RORK-FREE-404710d1bd1826ef`

---

## Declaration

**IVX Holdings is technologically independent from Rork Toolkit/SDK.**

**Rork continues to serve as Senior IA Developer under IVX IA Autonomous Audit governance.**

---

## Technical Independence Status

| Dependency | Status | Evidence |
|------------|--------|----------|
| `@rork-ai/toolkit-sdk` in `package.json` | **REMOVED** | No SDK in dependencies |
| `withRorkMetro` wrapper in `metro.config.js` | **REMOVED** | Plain Expo default config |
| `EXPO_PUBLIC_RORK_*` env vars in app runtime | **REMOVED** | Direct Render/Supabase URLs only |
| `EXPO_PUBLIC_TOOLKIT_URL` | **REMOVED** | No toolkit proxy calls |
| Backend Rork Toolkit proxy | **REMOVED** | Direct Vercel AI Gateway + OpenAI |
| Landing page Rork references | **NONE** | Independent Supabase auth |

---

## Rork Role: Senior IA Developer

| Field | Value |
|-------|-------|
| **Title** | Senior IA Developer |
| **Governance** | IVX IA Autonomous Audit |
| **Scope** | Code review, autonomous development assistance, certification audits, and architectural guidance under IVX owner control |
| **Platform Access** | None at runtime. No SDK. No toolkit proxy. No environment variable dependency. |
| **Status** | **RETAINED** |

Rork operates as an autonomous development assistant **within** IVX governance, not as a platform owner or runtime dependency.

---

## Live Runtime Proof

### Backend Health
```
ok: true
status: healthy
commit: cb4b3a944c71a14bc77304c8d551386ce849cc34
```

### `/api/landing-config`
```
ok: true
supabaseUrl: https://kvclcdjmjghndxsngfzb.supabase.co
apiBaseUrl: https://api.ivxholding.com
containsRork: false
```

### Supabase Auth (Landing Page Path)
```
success: true
email: iperez4242@gmail.com
role: owner
mfaFactors: 0
```

### Backend Login
```
success: true
hasAccessToken: true
requiresMFA: false
```

### api.ivxholding.com Health
```
ok: true
status: healthy
```

---

## Recent GitHub Commits

| SHA | Message |
|-----|---------|
| `cb4b3a944c71` | fix: remove trailing comma in package.json — fix Metro parse error |
| `7dffd94008a0` | feat: remove rorkApiBaseUrl fallback — use apiBaseUrl only |
| `772c3c8e7347` | feat: remove EXPO_PUBLIC_RORK_API_BASE_URL read — use Render directly |
| `80efe26042ff` | feat: remove @rork-ai/toolkit-sdk dependency — IVX fully independent |
| `b5ca5bc4e5d0` | feat: remove withRorkMetro wrapper — IVX fully independent |

---

## Proof Hash

`3da40aac10e24caf`

---

*This document certifies that IVX Holdings maintains full runtime independence from Rork Toolkit while retaining Rork as Senior IA Developer under IVX IA Autonomous Audit governance.*
