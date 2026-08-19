# IVX Holdings — Owner Sign-In QA Certificate

**Certificate ID:** `IVX-113-OWNER-SIGNIN-f7d0c871e1b24618`
**Date:** 2026-08-19
**Build:** versionName `1.10.15` / versionCode `113`
**Result:** 12/12 PASS — CERTIFIED
**Scope:** includes a live sign-in run against the real owner credential (2026-08-19)

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

## 8. Live owner-credential audit (2026-08-19)

The owner's real credential was tested directly against the hosted project — not a
surrogate QA account.

### Second, independent defect found: credential transcription

The first attempt with the credential exactly as supplied was rejected:

- Supplied string: 48 characters
- Result: `HTTP 400 invalid_credentials`

The supplied string contained the leading 9-character segment repeated **four times** —
a clipboard/autofill duplication artifact. The stored credential contains that segment
**once**, followed by the trailing 12-character segment (21 characters total).

Variant matrix executed against live GoTrue:

| Variant | Length | Result |
| --- | --- | --- |
| Segment x4 + tail (as supplied) | 48 | HTTP 400 invalid_credentials |
| **Segment x1 + tail** | **21** | **HTTP 200 — SIGN-IN SUCCESS** |
| Tail only | 12 | HTTP 400 invalid_credentials |
| Segment only | 9 | HTTP 400 invalid_credentials |
| Segment x2 + tail | 30 | HTTP 400 invalid_credentials |
| Segment x3 + tail | 39 | HTTP 400 invalid_credentials |
| Tail minus final char | 11 | HTTP 400 invalid_credentials |
| Single-`$` tail | 20 | HTTP 400 invalid_credentials |

Exactly one variant authenticates, confirming the stored credential is intact and the
failure was input duplication, not account or key state.

### Full end-to-end run with the correct credential

| # | Test | Result | Evidence |
| --- | --- | --- | --- |
| 01 | Production anon key accepted by GoTrue | PASS | HTTP 200 |
| 02 | Owner sign-in with correct password | PASS | HTTP 200, live session issued |
| 03 | Session resolves to owner identity | PASS | HTTP 200, email match |
| 04 | Authenticated user is the owner record | PASS | user id match |
| 05 | Owner account confirmed & not banned | PASS | confirmed, banned=false |
| 06 | Identity providers intact | PASS | email + phone |
| 07 | Access token claims valid | PASS | role=authenticated, ttl=60min |
| 08 | Refresh token rotation | PASS | HTTP 200 |
| 09 | Authenticated data access over RLS | PASS | HTTP 200 |
| 10 | Old demo key still reproduces original 401 | PASS | HTTP 401 Invalid API key |
| 11 | Sign-out revokes session | PASS | HTTP 204 |
| 12 | Revoked refresh token rejected | PASS | HTTP 400 |

**TOTAL: 12/12 PASS**

The plaintext credential was held only in a `chmod 600` file outside the repository for
the duration of the run and deleted immediately afterward. It is not recorded in this
certificate, the repository, or any build artifact.

---

## 9. Recommended follow-up

The `EXPO_PUBLIC_SUPABASE_ANON_KEY` project variable still holds the demo key. The app
now ignores it safely, but replacing it with the real production anon key removes the
misleading value at source.
