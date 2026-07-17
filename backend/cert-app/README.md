# IVX Senior Developer Certification App

Isolated application built from scratch to certify IVX IA's production Senior Developer capabilities.

## Architecture
- **Backend:** Hono sub-app mounted at `/api/cert-app/*` within the IVX backend
- **Database:** Isolated in-memory SQLite (completely separate from IVX production Supabase)
- **Frontend:** Responsive web interface served at `/cert-app`
- **Auth:** Bearer token auth with isolated cert-app tokens (no IVX production credentials)

## Isolation Guarantees
- No access to IVX production business tables
- No copied secret values
- Separate database (in-memory SQLite vs production Supabase)
- Separate auth tokens
- No shared state with IVX production runtime

## Endpoints
- `GET  /api/cert-app/health` — Health check
- `GET  /api/cert-app/readiness` — Readiness check
- `POST /api/cert-app/auth/login` — Login
- `GET  /api/cert-app/items` — List items (paginated)
- `GET  /api/cert-app/items/:id` — Get item
- `POST /api/cert-app/items` — Create item
- `PUT  /api/cert-app/items/:id` — Update item
- `DELETE /api/cert-app/items/:id` — Delete item

## Rollback
- Remove `backend/cert-app/` directory
- Remove cert-app route registration from `backend/hono.ts`
- No database migration rollback needed (in-memory SQLite, no persistent state)
