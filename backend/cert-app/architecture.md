# IVX Senior Developer Certification App — Architecture Decision Record

## Requirement
"Build a task management application with login, CRUD operations, search, pagination, and status filtering."

## Assumptions
1. Single-tenant application for certification testing only
2. In-memory database is sufficient (no persistent storage required for certification)
3. Bearer token auth is sufficient (no OAuth/SAML needed)
4. Maximum 50 items per page (pagination limit)
5. No file uploads needed
6. No real-time updates needed (polling sufficient)

## User Stories
1. As a user, I can log in with email and password to access the app.
2. As a user, I can view a list of my items with pagination.
3. As a user, I can search items by title or description.
4. As a user, I can filter items by status (draft, active, archived).
5. As a user, I can create a new item with title, description, and status.
6. As a user, I can view item details.
7. As a user, I can edit an existing item.
8. As a user, I can delete an item.
9. As a user, I see loading states while data is being fetched.
10. As a user, I see empty states when no items exist.
11. As a user, I see error messages when something goes wrong.

## Acceptance Criteria
1. Login screen accepts email + password, returns bearer token
2. All CRUD routes require authentication (401 without token)
3. List endpoint supports page + limit pagination
4. List endpoint supports status filter
5. List endpoint supports search query
6. Create validates: title required, max 200 chars, status must be valid enum
7. Update validates same as create
8. Delete returns 404 for nonexistent items
9. Health endpoint returns 200 without auth
10. Readiness endpoint returns 200 when DB is ready, 503 when not
11. Every response includes a trace ID
12. Rate limiting: 100 requests per minute per IP
13. Error responses never expose stack traces
14. Frontend is responsive (mobile + desktop)

## Architecture Decision Record
- **ADR-001: In-memory database** — Chosen for isolation. No access to IVX production Supabase. Risk: data lost on restart. Mitigation: acceptable for certification app.
- **ADR-002: Bearer token auth** — Simple, stateless, sufficient for single-user cert app. No OAuth complexity needed.
- **ADR-003: Hono sub-app** — Mounted within existing IVX backend at `/api/cert-app/*`. No separate server process needed. Isolated routes, isolated data.
- **ADR-004: Index-based filtering** — Map-based indexes on status and title for O(1) lookups instead of O(n) scans.

## Data Model
```
CertItem {
  id: string (PK, generated)
  title: string (required, max 200 chars)
  description: string (optional)
  status: enum (draft, active, archived)
  ownerId: string (FK to CertUser.id)
  createdAt: ISO 8601 timestamp
  updatedAt: ISO 8601 timestamp
}

CertUser {
  id: string (PK)
  email: string
  name: string
  createdAt: ISO 8601 timestamp
}
```

## API Contract
| Method | Route | Auth | Body | Response |
|--------|-------|------|------|---------|
| GET | /api/cert-app/health | No | - | 200 {ok, status, version} |
| GET | /api/cert-app/readiness | No | - | 200/503 {ok, ready, checks} |
| POST | /api/cert-app/auth/login | No | {email, password} | 200 {token, user} / 401 |
| GET | /api/cert-app/items | Yes | - | 200 {data, pagination} |
| POST | /api/cert-app/items | Yes | {title, description, status} | 201 {data} / 400 |
| GET | /api/cert-app/items/:id | Yes | - | 200 {data} / 404 |
| PUT | /api/cert-app/items/:id | Yes | {title, description, status} | 200 {data} / 404 |
| DELETE | /api/cert-app/items/:id | Yes | - | 200 {deleted} / 404 |

## Threat Model
1. **Unauthenticated access** — Mitigated: all CRUD routes require bearer token
2. **Brute force login** — Mitigated: rate limiting (100 req/min)
3. **Information disclosure** — Mitigated: error responses sanitized, no stack traces
4. **Input injection** — Mitigated: input validation, max length enforcement
5. **Oversized payload** — Mitigated: title max 200 chars, pagination max 50
6. **XSS** — Mitigated: frontend uses textContent (escapeHtml function)

## Deployment Plan
1. Code committed to existing IVX backend repository
2. Backend deployed to Render (same service as IVX backend)
3. Cert-app routes accessible at `https://api.ivxholding.com/api/cert-app/*`
4. Frontend accessible at `https://api.ivxholding.com/cert-app`

## Test Plan
- Unit tests: database CRUD, indexing, pagination, filtering
- Integration tests: API endpoints, auth, validation
- Authorization tests: all CRUD routes require auth
- Security tests: trace IDs, error sanitization, rate limiting
- Frontend tests: HTML structure validation, no hardcoded secrets

## Rollback Plan
1. Remove `backend/cert-app/` directory
2. Remove cert-app route registration from `backend/hono.ts`
3. No database migration rollback needed (in-memory, no persistent state)
4. Redeploy backend

## Ambiguous Requirements Identified
1. "Task management" — clarified: simple CRUD items, not a full project management suite
2. "Search" — clarified: text search on title and description fields only
3. "Login" — clarified: single hardcoded password for certification, no user registration
