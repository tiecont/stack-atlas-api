# Stack Atlas API

The API is a NestJS modular monolith and the business/control plane. It owns
learner and operational state; authored learning content remains in the Web
repository. Business code belongs in a named feature under `src/modules/`.

## Local setup

Requirements: Node.js 22.13 or later and Docker Compose v2.1 or later. The
included local database uses PostgreSQL 16; other PostgreSQL versions 14 or
later are supported.

```sh
npm ci
cp .env.example .env
docker compose up -d --wait postgres
npm run migration:up
npm run start:dev
```

The API listens on `PORT` (default `3000`). Routes use the `/api/v1` prefix.
Liveness is `GET /api/v1/health`; readiness is `GET /api/v1/health/ready` and
checks PostgreSQL. OpenAPI JSON is at `/docs-json`, with Swagger UI at `/docs`.
The local `.env.example` allows the Next.js Web origin `http://localhost:3001`;
keep that exact origin in `CORS_ORIGINS` when developing account flows. Browser
clients must send credentials so the HttpOnly session cookie is stored and sent
across the two local ports. An empty `CORS_ORIGINS` disables cross-origin access.

## Developing alongside Web and Engine

The API owns account/session state and runs independently of both other
repositories. Start it on port `3000`; Web runs on port `3001`. The Engine is not
needed for health, identity, or account UI work. Its execution event contract
and worker wiring are a separate integration phase; no Web request should call
the Engine directly.

Stop the local database with `docker compose down`. Its named volume preserves
local data between sessions.

## Database changes

Create a schema migration with `npm run migration:create -- feature_name`, then
apply pending migrations with `npm run migration:up`. Migration filenames begin
with an automatically generated UTC timestamp. Once a migration is deployed,
keep it immutable and make later schema or data changes in new migrations.

The PostgreSQL integration test uses a dedicated disposable database configured
through `DATABASE_TEST_URL`; it applies pending migrations and checks the
resulting schema and migration record. Do not point this variable at a database
containing data that must be preserved.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run test:integration
npm run build
```

The HTTP error contract is **Stack Atlas Problem Details v1**, using RFC 9457
`application/problem+json`. The API produces it and Web clients consume it. The
API always sends `type`, `title`, `status`, and
`instance`; `detail` is optional. Web keeps unknown extension members and treats
the HTTP status as authoritative.

The cross-repository check is `make test-api-integration` in Web while this API
and PostgreSQL are running. It verifies liveness, database readiness, and a 404
problem response against Web's local fixture. Unit tests and the health HTTP
tests use local fakes. The identity lifecycle HTTP test runs when
`DATABASE_TEST_URL` is set and requires its disposable PostgreSQL database; no
API test requires a running Engine.

Identity routes implement **Stack Atlas Identity v1**. Its account/session
contract, cookie policy, integration test, release order, and follow-up security
dependencies are documented in [`docs/contracts/identity-v1.md`](docs/contracts/identity-v1.md).
