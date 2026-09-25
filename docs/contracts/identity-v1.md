# Stack Atlas Identity v1

**Producer:** `stack-atlas-api` identity module<br>
**Consumer:** the Next.js account UI in `stack-atlas-web` (`/login`, `/register`, and `/account`). Public knowledge pages do not require this contract.

All routes use the `/api/v1` prefix. JSON responses expose only `id`, `email`,
and `createdAt`; password hashes and session identifiers are server-side only.
Errors use Stack Atlas Problem Details v1 (`application/problem+json`).

| Operation | Request | Success | Authentication |
| --- | --- | --- | --- |
| `POST /api/v1/account` | `{ "email": string, "password": string }` | `201` account | None |
| `POST /api/v1/auth/login` | `{ "email": string, "password": string }` | `200` account and session cookie | None |
| `GET /api/v1/account/me` | No body | `200` account | Session cookie |
| `POST /api/v1/auth/logout` | No body | `204`, session revoked and cookie cleared | Session cookie |

Account email is trimmed and lowercased before storage. Passwords must be 12–128
characters. Unknown-account and wrong-password login failures both return the
same `401` Problem Details response. Duplicate account creation returns `409`.
Unknown request fields and invalid inputs return `400`.

## Session cookie

Successful login sets `stack_atlas_session` with an opaque 256-bit random value.
The API stores only its SHA-256 digest. The cookie is `HttpOnly`, `SameSite=Lax`,
scoped to `/api/v1`, and has a seven-day maximum age matching the database
expiration. `Secure` is enabled in production. The cookie has no `Domain`
attribute. Auth responses use `Cache-Control: no-store`; the session value is
never returned in JSON.

When an `Origin` header is present on account creation, login, or logout, it must
match one of the exact `CORS_ORIGINS` configured for the API. Browser clients
must send credentials for cross-origin requests. The current cookie policy is
for same-site deployments; a cross-site Web/API deployment needs an explicit
CSRF design and cookie-policy update before launch.

## Compatibility and integration

Within v1, account JSON fields, route meanings, cookie name/path, and error
semantics are stable. Clients should not persist the session value outside the
browser cookie jar. The Web account UI uses credentialed requests when
cross-origin and handles RFC 9457 responses. Local development uses Web
`http://localhost:3001` and API `http://localhost:3000`; API `CORS_ORIGINS` must
include the exact Web origin.

**Required API integration test:** run `npm run test:e2e` with
`DATABASE_TEST_URL` pointing to a disposable PostgreSQL database. The identity
HTTP test applies migrations and covers account creation, validation, duplicate
email, indistinguishable login failures, cookie issuance, current-account
lookup, origin rejection, logout revocation, and session expiry.

**Safe release order:** apply the additive API migration, deploy the API, then
release any Web sign-in UI. The current Web public-knowledge plan has no Identity
dependency. The next protected learner-state API work should reuse the session
principal and `SessionAuthGuard`; it must not accept a user ID from request data
as ownership authority.

## Follow-up dependencies

This slice does not send email. Email verification and password recovery need an
owned delivery workflow before accounts are treated as verified. Production
login also needs a shared rate limit at the API edge or another durable shared
service before public credential traffic is enabled; a per-process counter
would not be correct for multiple API replicas. MFA and account/session
management UI are later identity work.
