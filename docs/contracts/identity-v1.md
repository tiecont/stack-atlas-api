# Stack Atlas Identity v1

**Producer:** `stack-atlas-api` identity module<br>
**Consumer:** the Next.js account UI in `stack-atlas-web` (`/login`, `/register`,
and `/account`). Public knowledge pages do not require this contract.

All routes use the `/api/v1` prefix. JSON account representations contain only
`id`, `email`, and `createdAt`. Password hashes and session identifiers remain
server-side. Errors use Stack Atlas Problem Details v1 with
`application/problem+json`.

| Operation | Request | Success | Failure semantics |
| --- | --- | --- | --- |
| `POST /api/v1/account` | `{ "email": string, "password": string }` | `201` safe account | `400` invalid input; `403` disallowed Origin; `409` duplicate email |
| `POST /api/v1/auth/login` | `{ "email": string, "password": string }` | `200` safe account and session cookie | `400` invalid input; `401` invalid credentials; `403` disallowed Origin |
| `GET /api/v1/account/me` | No body | `200` safe account | `401` missing, malformed, expired, or revoked session |
| `POST /api/v1/auth/logout` | No body | `204`, session durably revoked and cookie cleared | `401` invalid session; `403` disallowed Origin |

Email is trimmed and lowercased. Passwords must be 12–128 characters. Unknown
request fields are rejected. PostgreSQL enforces unique normalized email, so
concurrent duplicate registrations return one `201` and one `409`. Unknown-user
and wrong-password login failures have the same status and public problem fields;
each request receives its own request ID.

## Problem Details and request context

HTTP errors use RFC 9457 `application/problem+json` with `type`, `title`,
`status`, and `instance`. A generated UUID is returned in `X-Request-Id` and in
the `requestId` extension. The server does not copy exception messages or SQL
details into client responses. Error responses use `Cache-Control: no-store`.
The API also returns `no-store` for account registration, login, current-account,
and logout responses.

The server generates each request ID and does not adopt an arbitrary inbound
request ID. The same generated UUID appears in `X-Request-Id` and the
`requestId` Problem Details extension.

## Feature ownership

The public routes remain stable while implementation ownership follows the
feature boundary: Account owns registration, password hashing, email policy,
and account persistence; Session owns token creation, hashing, expiry, lookup,
and revocation; Authentication owns login, logout, the authenticated principal,
and `GET /account/me`. Controllers call feature services, services apply policy
and call repositories, and repositories own SQL. The reusable exact-origin
guard lives in common HTTP security and is shared by registration and
authentication without a module cycle.

## Session cookie

Successful login sets the configured cookie name (`stack_atlas_session` by
default) to an opaque 256-bit random value. The API stores only its SHA-256
digest. The cookie is `HttpOnly`, `SameSite=Lax`, scoped to `/api/v1`, and has a
Max-Age equal to the database session lifetime. The default lifetime is seven
days; `SESSION_TTL_SECONDS` is validated from 1 second through 30 days. `Secure`
is enabled whenever `NODE_ENV=production`. The cookie has no `Domain` attribute.
The session value is never returned in JSON.

## Origin and CSRF assumptions

The local Web origin is `http://localhost:3001`; the API listens on
`http://localhost:3000`, and PostgreSQL on port `5432`. `CORS_ORIGINS` is an
exact comma-separated origin allowlist and defaults locally to
`http://localhost:3001`. Credentialed CORS never uses a wildcard. Production
origins must use HTTPS. When an Origin header is present on account creation,
login, or logout, it must match the configured allowlist. Browser clients must
send credentials for cross-origin requests.

The cookie policy assumes same-site Web/API deployment. A cross-site deployment
requires an explicit CSRF design and a cookie-policy change before launch. The
current policy does not claim to protect arbitrary cross-site deployments.
When a browser sends `Origin`, registration, login, and logout require an exact
configured-origin match; requests without an Origin header remain supported for
non-browser clients.

## Security limitations

Passwords are stored with scrypt and random salts. Unknown accounts follow the
same dummy scrypt verification path as incorrect passwords. Session lookup
checks expiry and revocation in PostgreSQL; logout revokes the durable row before
clearing the cookie. Session credentials are never stored in plaintext.

Shared login rate limiting is not implemented. Add edge-based or durable shared
rate limiting before public credential traffic; a per-process counter would not
work across API replicas. Email verification, password recovery, MFA, and
session-management UI are later identity work.

## Compatibility and integration

Within v1, route meanings, safe account fields, cookie semantics, and error
status classification are stable. Clients should not persist the session value
outside the browser cookie jar. The Web account UI uses credentialed requests
when cross-origin and handles RFC 9457 responses. The API runs independently of
Web and Engine; the Engine is not needed for identity.

The identity HTTP integration suite runs with `DATABASE_TEST_URL` pointing to a
disposable PostgreSQL database. It applies migrations and covers validation,
email normalization, duplicate and concurrent registration, indistinguishable
login failures, cookie issuance, active/expired/revoked sessions, origin checks,
current-account lookup, and logout revocation. Migration integration tests
cover PostgreSQL constraints and transaction commit/rollback behavior.

Deployed migrations are immutable. Apply additive API migrations before
releasing any Web changes that depend on them. Protected learner-state features
should use the authenticated principal and must not accept a user ID from
request data as ownership authority.

The initial email-normalization migration first detects collisions under
`lower(btrim(email))`. It fails with a clear message before updating any rows if
collisions exist. Otherwise it normalizes legacy values and adds a check
constraint, preserving the existing unique constraint.
