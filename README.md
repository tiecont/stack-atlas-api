# Stack Atlas API

The API is a NestJS modular monolith and the business/control plane. It owns
account, session, learner, submission, and operational state in PostgreSQL.
Authored learning content remains in the Web repository. Business code belongs
in a named feature under `src/modules/`.

## Local setup

Requirements: Node.js 22.13 or later and Docker Compose v2.1 or later. The
included local database uses PostgreSQL 16. The Compose project is explicitly
named `stack-atlas-api` to isolate its containers and volumes from other
repositories.

```sh
npm ci
cp .env.example .env
docker compose up -d postgres
npm run build
npm run migrate
npm run start:dev
```

For containerized development:

```sh
docker compose up -d postgres
docker compose run --build --rm api npm run build
docker compose run --rm api npm run migrate
LOCAL_UID="$(id -u)" LOCAL_GID="$(id -g)" docker compose up --build -d api
```

The local ports are Web `3001`, API `3000`, and PostgreSQL `5432`. The API uses
the `/api/v1` prefix. Liveness is `GET /api/v1/health`; readiness is
`GET /api/v1/health/ready` and checks PostgreSQL. OpenAPI JSON is at `/docs-json`,
with Swagger UI at `/docs`.

## Configuration

`DATABASE_URL` is required. Environment values are validated before Nest
starts, then exposed through the typed application configuration. Local defaults
are `NODE_ENV=development`, `PORT=3000`, `DB_POOL_MAX=10`,
`CORS_ORIGINS=http://localhost:3001`, cookie name `stack_atlas_session`, and a
seven-day session TTL. Set `CORS_ORIGINS` to an empty value to disable browser
CORS; otherwise use a comma-separated list of exact origins. Production requires
HTTPS origins and always sets the session cookie's `Secure` attribute.

`POSTGRES_PORT` and `API_PORT` change the host ports published by the development
Compose file. When changing `POSTGRES_PORT` for host-run commands, update both
database URLs to use that port. `LOCAL_UID` and `LOCAL_GID` set the user used by
the development container for bind-mounted files. `DATABASE_TEST_URL` points to
the disposable local test database; the Postgres init script creates it when
the named data volume is first created. PostgreSQL tests require
`ALLOW_DESTRUCTIVE_TEST_DATABASE=true` and refuse non-local hosts or database
names outside the Stack Atlas test allowlist.
If reusing a volume created before that script existed, create the test database
once with `CREATE DATABASE stack_atlas_test OWNER stack_atlas`.

`SESSION_TTL_SECONDS` accepts values from 1 second through 30 days. The cookie
is HttpOnly, SameSite=Lax, scoped to `/api/v1`, and has a matching Max-Age. Do
not put secrets in environment examples or commit a local `.env` file.

## Identity and HTTP contract

Identity v1 provides:

- `POST /api/v1/account` — register an account (`201`; duplicate email `409`)
- `POST /api/v1/auth/login` — issue an opaque session cookie (`200`)
- `GET /api/v1/account/me` — return the authenticated account (`200`)
- `POST /api/v1/auth/logout` — durably revoke the current session (`204`)

Account email is trimmed and lowercased. PostgreSQL enforces uniqueness and
normalization. The registration path is `AccountController -> AccountService ->
AccountRepository -> DatabaseService`; authentication owns login, logout, and
the current-account route, while session SQL belongs to `SessionRepository`.
Password hashing stays in Account. Reusable exact-origin enforcement lives in
the common HTTP security boundary. Passwords use scrypt; session tokens are
random 256-bit values, and only their SHA-256 digests are stored. A session
principal comes from the active database session, never from request ownership
fields.

Errors use RFC 9457 `application/problem+json`. Responses include a generated
`X-Request-Id`, repeated as the `requestId` Problem Details extension. Error
responses and identity responses use `Cache-Control: no-store`. CORS allows only
the configured exact origins with credentials. Identity state-changing routes
also reject a supplied Origin that is outside that allowlist.

The current cookie policy assumes same-site Web/API deployment. A cross-site
deployment needs an explicit CSRF design and cookie policy update before use.
Only supplied Origin headers are checked against the exact configured allowlist;
browser clients are expected to use the same-site deployment described above.
Email verification and password recovery are not implemented. Login has no
shared rate limiter; add edge or durable shared rate limiting before public
credential traffic. MFA and session-management UI are later identity work.
The Engine is not needed for health or identity and is not a startup dependency.

## Content platform foundation

The API now owns stable article identity, validated immutable revisions, and
publication history in PostgreSQL. The content service is not exposed through
HTTP yet; authoring endpoints and admin authorization are the next API phase.
Web Git remains the canonical authored source, and this foundation does not
import existing articles or change Web reads. See
[`docs/architecture/content-platform.md`](docs/architecture/content-platform.md)
for the phase boundary and
[`docs/contracts/content-v1.md`](docs/contracts/content-v1.md) for the V1
document and persistence rules.

See [`docs/contracts/identity-v1.md`](docs/contracts/identity-v1.md) for the
stable endpoint and cookie contract.

## Database changes

PostgreSQL owns the `stack_atlas` schema. After `npm run build`, create a new
schema migration beside its owning feature:

```sh
npm run migration:create -- identity account AddAccountStatus
npm run migration:check-timestamps
npm run migration:preflight
npm run migrate
```

The generator runs `date +%s%3N` and creates a timestamped TypeScript class in
`src/modules/<context>/<feature>/migrations/`. Data transformations belong in
`data-migrations/`; keep those separate from schema changes. `npm run migrate`
applies deployed legacy history and feature schema migrations. Run data changes
only through the explicit `npm run migration:data-up` command after
`npm run migration:preflight:data` confirms that schema prerequisites are met.
The runner keeps the deployed root and nested JavaScript migration history on
`node-pg-migrate`, then discovers feature-owned TypeScript migrations from
compiled output. It applies each group in timestamp order and rolls them back in
reverse order. Do not add new JavaScript migrations.

`migration:preflight` is read-only: it checks the configured target, migration
history, source availability, and pending counts. `migrate` runs the same
preflight before applying. `migration:down` reverses one latest feature
migration, or one legacy migration after feature migrations are exhausted.
Review the target and migration SQL before applying or rolling back.
A failed feature migration rolls back its transaction; a failed legacy
migration follows `node-pg-migrate` transaction behavior. Fix the cause and
rerun the same command after checking the applied histories.

CI runs `migration:verify` against a randomly named disposable PostgreSQL
database. Set `DATABASE_VERIFY_ADMIN_URL` to a PostgreSQL administrator
connection for the `postgres` maintenance database with permission to create
and drop databases. The verification command applies all legacy and schema
migrations, applies data migrations after schema migrations, checks histories
and counts by kind, rolls them back, and drops only the
randomly named disposable database it created. Run it after `npm run build`.
If the process is forcibly terminated before cleanup, inspect the database
cluster for only the `stack_atlas_migration_verify_` database created by that
run and remove that temporary database after confirming no verifier is active.

Treat deployed migrations as immutable; use new migrations for later changes
and use expand, backfill, verify, then contract for destructive evolution.

`DatabaseService` owns the single pool lifecycle and exposes a checked-out-client
transaction primitive. Identity operations currently need only single-row SQL
statements; PostgreSQL constraints remain authoritative under concurrent writes.
There is no global `statement_timeout` until a measured requirement justifies
one.

The email normalization migration checks for collisions under
`lower(btrim(email))` before changing any row. It aborts with a collision count
and leaves data unchanged if resolution is needed; otherwise it normalizes
legacy values and adds a database check for future writes.

## Docker development and production

`Dockerfile` has a `development` target for bind-mounted source and a
`production` target with compiled output, runtime dependencies, migrations, and
a fixed non-root user. `compose.yaml` is for local development only: it selects
the development target, mounts the repository and a named `node_modules`
volume, and runs the API with the host UID/GID. It uses the explicit
`stack-atlas-api` Compose project/resource names so another directory named
`api` cannot share its containers or networks. Do not use Compose as the
production deployment definition.

CI builds the production target for pull requests. Pushes to `main`, `develop`,
and `v*` tags publish the image to `ghcr.io/<owner>/stack-atlas-api` only after
the test job succeeds. `main` publishes `latest`, `develop` publishes
`develop-latest`, and version tags publish version and commit-SHA tags. This repo
does not yet define a production deployment environment or credentials, so CD
ends at publishing the verified image.

## Checks

`npm ci` installs the Husky pre-commit hook. Commits run ESLint and Prettier on
staged TypeScript files, then run `npm run test:precommit` (typecheck, lint, unit
tests, and build). PostgreSQL integration and HTTP end-to-end tests stay in CI
because they require a disposable PostgreSQL database.

Unit and HTTP foundation tests:

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run migration:check-timestamps
```

PostgreSQL-backed integration and identity HTTP tests require a disposable
database in `DATABASE_TEST_URL`:

```sh
npm run build
npm run migration:verify
npm run test:integration
npm run test:e2e
```

`npm run migrate` applies legacy and feature schema migrations. Data migrations
are separate: run `npm run migration:preflight:data`, then
`npm run migration:data-up` only after all schema migrations are applied. The
CI workflow creates separate integration and e2e databases. For local runs, the
same disposable test database may be reused because each suite applies the
canonical migration runner before exercising the API. The integration and e2e
commands fail if `DATABASE_TEST_URL` or the destructive-test opt-in is missing.

The GitHub Actions workflow runs these checks against PostgreSQL 16 and verifies
migrations from an empty disposable database, including rollback. Never point
tests at a database containing data that must be preserved. No API test requires
a live Engine. Production migration release steps are in
[`docs/operations/migrations.md`](docs/operations/migrations.md).
