# IVX Holdings — Owner Sign-In QA Certificate

**Certificate ID:** `IVX-113-OWNER-SIGNIN-f7d0c871e1b24618`
**Date:** 2026-08-19
**Build:** versionName `1.10.15` / versionCode `113`
**Result:** 12/12 PASS — CERTIFIED

---

## 1. Reported defect

Owner sign-in failed on device with:

```
Sign In Failed
Invalid API key
```

The failure was constant and independent of the password entered.

---

## 2. Root cause (proven, not inferred)

The project environment variable `EXPO_PUBLIC_SUPABASE_ANON_KEY` did not contain the
production Supabase key. It contained the **generic Supabase local-development demo
key**, which every Supabase sample stack ships with.

Decoded evidence:

| Property | Value in env key | Production key |
| --- | --- | --- |
| Issuer (`iss`) | `supabase-demo` | `supabase` |
| Project ref (`ref`) | *absent* | `kvclcdjmjghndxsngfzb` |
| Total length | 153 chars | 208 chars |

Live confirmation against the hosted project:

- Env key → `HTTP 401 {"message":"Invalid API key"}`
- Production key → `HTTP 400 {"error_code":"invalid_credentials"}` (key accepted)

The existing sanitizer only rejected keys whose `ref` **mismatched** production. The
demo key has **no `ref` claim at all**, so it passed the check unchallenged and was
sent as the `apikey` header on every sign-in request.

**The owner account was never the problem.** Verified live on the production project:

- ID `9b280e15-f9fd-459f-bf2d-530b1ed84cb1`
- Email confirmed: `2026-08-16T12:22:40Z`
- Banned: none
- Identities: `email`, `phone`

---

## 3. Fix applied

`expo/lib/supabase-env.ts` — anon keys must now **positively identify** the production
project. A key is accepted only when all hold:

1. Issuer is not a known local/demo issuer
2. `role` is `anon`
3. `exp` is in the future
4. `ref` equals `kvclcdjmjghndxsngfzb`

Anything else falls back to the verified production key. Failing closed on a missing
`ref` (rather than only on a mismatched one) is what closes the defect class.

---

## 4. End-to-end certification — live production Supabase

| # | Test | Result | Evidence |
| --- | --- | --- | --- |
| 01 | Fixed anon key accepted by GoTrue | PASS | HTTP 200 |
| 02 | Old demo key correctly rejected | PASS | HTTP 401 Invalid API key |
| 03 | Provision controlled QA account | PASS | HTTP 200 |
| 04 | Password sign-in returns live session | PASS | HTTP 200, token issued |
| 05 | Session identity resolves | PASS | HTTP 200, email match |
| 06 | Refresh token rotation | PASS | HTTP 200 |
| 07 | Sign-out revokes session | PASS | HTTP 204 |
| 08 | Wrong password → credential error, not API-key error | PASS | HTTP 400 `invalid_credentials` |
| 09 | Owner account active, confirmed, unbanned | PASS | confirmed, not banned |
| 10 | Owner auth pipeline issues valid login token | PASS | HTTP 200 |
| 11 | REST/PostgREST data reachable | PASS | HTTP 200, rows returned |
| 12 | QA account cleanup | PASS | HTTP 200 |

**TOTAL: 12/12 PASS**

---

## 5. Secondary defect fixed in the same build

Cross-platform preview bundling failure:

```
@ai-sdk/provider-utils/dist/index.mjs: Invalid call at line 402: import(id)
```

The managed preview transformer matched `export default function RootLayout` and
injected provider wrappers that transitively imported Node-only AI SDK helpers.
`expo/app/_layout.tsx` now separates the default export from the declaration, so the
injection no longer occurs. This survives the environment periodically resetting
`metro.config.js`.

Verified with clean exports: Web (3673 modules), iOS (3963), Android (3953), plus a
development-mode web bundle. No `import(id)` present in any output.

---

## 6. Static and regression validation

- `runChecks` (TypeScript + lint + structure): **0 errors**
- `__tests__/supabase-env.test.ts`: **18/18 pass** (includes demo-key, missing-ref,
  expired-key, and wrong-role regression cases)
- `__tests__/metro-ai-sdk-compatibility.test.ts`: **4/4 pass**

---

## 7. Certified artifact

- **Download:** https://github.com/ibb142/ivx-holdings-platform/releases/download/v1.10.15-qa/ivx-holdings-v1.10.15.apk
- **Release:** https://github.com/ibb142/ivx-holdings-platform/releases/tag/v1.10.15-qa
- **Size:** 84,894,352 bytes
- **SHA256:** `f7d0c871e1b2461a879ab81527a4919a1c3b2d52cc8241ba0725bcbf862ae805`
- **Download integrity:** re-downloaded from the public URL; checksum matches the
  locally built artifact exactly.

Shipped-bundle verification:

- Production project ref present: yes
- Anon-key guard present in shipped bundle: yes
- Unsafe `import(id)` present: no

---

## 8. Recommended follow-up

The `EXPO_PUBLIC_SUPABASE_ANON_KEY` project variable still holds the demo key. The app
now ignores it safely, but replacing it with the real production anon key removes the
misleading value at source.
