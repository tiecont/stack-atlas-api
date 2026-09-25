# Stack Atlas API — Agent Instructions

Canonical agent contract for `stack-atlas-api`.

The API is a NestJS modular monolith and Stack Atlas business/control plane.

## 1. Mandatory pre-work

Before editing:
1. identify bounded context;
2. identify named business feature;
3. inspect implementation/tests;
4. classify API, auth, migration, workflow, event, data, or integration change;
5. define transaction/idempotency needs;
6. define tests.

Do not perform unrelated cleanup.

## 2. Canonical architecture

```text
src/
  common/
  config/
  database/
  modules/
    health/
      controllers/
      services/
    identity/
      account/
        controllers/
        services/
        repositories/
        entities/
        dto/
        guards/
        helpers/
        errors/
        constants/
        types/
      authentication/
        controllers/
        services/
        repositories/
        entities/
        dto/
        guards/
        helpers/
        errors/
        constants/
        types/
      session/
        controllers/
        services/
        repositories/
        entities/
        dto/
        guards/
        helpers/
        errors/
        constants/
        types/
    learning/
      enrollment/
      progress/
      bookmark/
    assessment/
      quiz/
      mastery/
    exercise/
      catalog/
    submission/
      attempt/
      history/
    execution/
      orchestration/
      outbox/
      result-consumer/
    administration/
```

Future modules such as `organization`, `entitlement`, `notification` are added
only when their roadmap phase starts.

Business files MUST belong to a named feature.

Do not create module-root technical dumping grounds.

Each feature folder is its own bounded code owner. Keep its module/composition
file at the feature root and place implementation under layer folders such as
`controllers/`, `services/`, `repositories/`, `entities/`, `dto/`, `guards/`,
`helpers/`, `errors/`, `constants/`, and `types/` as needed. Create only folders
that contain real feature code. A bounded context root may contain only its
composition module and named feature folders; shared transport or persistence
mechanics belong in `common/` or `database/` only when they are truly cross-cutting.

Keep behavioral tests under their feature path in `test/` (`test/<context>/<feature>/`;
top-level platform features such as Health use `test/health/`). Keep migrations
under `database/migrations/<context>/<feature>/`. Keep existing root
migrations in place as deployed history. Migration runners must discover both
legacy root files and nested feature files. New migration names must come from
the migration generator and preserve chronological ordering with the existing
14-digit UTC root migrations. Create them with
`npm run migration:create -- <context> <feature> <name>`. Do not move, rename,
or edit a deployed migration.

## 3. Source of truth

PostgreSQL/API owns:
- users;
- sessions;
- enrollments;
- progress;
- attempts;
- submissions;
- execution jobs;
- result application;
- admin operational state;
- organizations/entitlements later.

Git/content system remains canonical for:
- article bodies;
- learning paths;
- exercise definitions;
- assessment definitions.

API may ingest/index metadata but must not become an accidental content CMS.

## 4. Database rules

PostgreSQL is primary transactional store.

Migrations:
- use real generated timestamp identity;
- append-only after deployment;
- schema and data migrations are distinct;
- destructive evolution follows expand -> backfill -> verify -> contract;
- migrations do not import runtime services;
- important migrations require integration tests.

## 5. Auth/authorization

Authentication establishes identity.

Authorization is server-authoritative.

Never trust:
- request user ID as ownership;
- organization ID as authority;
- stale token claims when immediate revocation matters.

Do not leak:
- passwords;
- tokens;
- internal security metadata.

## 6. Learning invariants

Reading != mastery.

Evidence tiers remain distinct:
- read;
- checkpoint passed;
- practiced;
- applied;
- verified later.

A canonical article may exist in many learning paths.

Progress semantics must preserve article identity while resume context can be
path-specific.

## 7. Submission invariants

Submission references immutable exercise version.

Initial state machine:

```text
DRAFT
-> QUEUED
-> RUNNING
-> PASSED
 | FAILED
 | COMPILE_ERROR
 | RUNTIME_ERROR
 | TIMEOUT
 | SYSTEM_ERROR
```

Invalid transitions fail.

Submission creation supports idempotency for client retries.

API never executes learner code.

## 8. Kafka and outbox

Execution uses asynchronous delivery.

Required submission pattern:

```text
BEGIN
  INSERT submission
  INSERT execution_job
  INSERT outbox_event
COMMIT
```

Outbox publisher sends `execution.requested.v1`.

Do not use direct DB insert + Kafka send as the only consistency model.

Assume at-least-once delivery.

Result consumer must be idempotent.

## 9. Event contract

Use shared integration contract.

Event envelope carries:
- event_id;
- event_type;
- schema_version;
- occurred_at;
- correlation_id;
- causation_id where applicable;
- traceparent where applicable;
- producer;
- data.

Never place secrets in Kafka messages.

## 10. Result application

Engine publishes result.

API owns business transition.

Consumer must:
- validate contract;
- deduplicate;
- reject stale terminal updates;
- transactionally update submission/attempt;
- update learning/mastery only after valid durable transition.

Engine must never mutate learner progress.

## 11. MongoDB/Redis

MongoDB is not default.

Adoption requires documented workload and source-of-truth ownership.

Redis may support cache/counters/fanout acceleration but must not be sole
durable truth for progress/submissions/entitlements.

## 12. API contracts

DTOs validate:
- IDs;
- enums;
- lengths;
- bounds;
- collection size;
- filter/sort allowlists.

Use explicit response contracts.

Keep OpenAPI aligned with implementation.

Do not expose ORM entities accidentally.

## 13. Testing

Use:
- unit tests for domain/policy logic;
- repository integration tests;
- HTTP e2e;
- migration tests;
- Kafka contract tests;
- cross-repo execution integration tests.

Critical flows:
- auth;
- progress;
- quiz;
- submission;
- duplicate creation;
- duplicate/stale execution result;
- authorization denial.

Every bug fix gets regression coverage.

## 14. Observability

Propagate:
- request ID;
- correlation ID;
- submission ID;
- execution ID;
- trace context.

Do not log learner source by default.

Measure:
- request/error/latency;
- auth failures;
- outbox backlog;
- Kafka publishing failures;
- submission creation;
- result-consumer failures.

## 15. Forbidden patterns

MUST NOT:
- execute user code;
- mutate progress directly from Engine;
- invent migration timestamps;
- use Kafka/Redis as business source of truth;
- add MongoDB without owned workload;
- create BaseService/BaseRepository hierarchy;
- hide cycles;
- accept client ownership as authority.

## 16. Independent development rule

API must be testable without a live Engine.

Use:
- Kafka contract fixtures;
- stub/fake consumer integration tests;
- deterministic result event fixtures.

Do not require Engine checkout for ordinary API unit/e2e development.

## 17. Verification

Repository-equivalent commands for:

```bash
npm run build
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

Migration/event changes require corresponding verification.

## 18. Completion report

```text
Summary
Bounded context / feature
Business invariants changed
Database/migrations
HTTP/event contracts
Tests/commands
Integration dependency
Remaining risks
```

## 19. Feature structure and dependency direction

Follow this dependency direction:

```text
HTTP controller -> application service -> feature repository -> Database
```

Controllers validate/translate HTTP input and call a use case; they do not own
business decisions or SQL. Services implement one feature's use cases and
policy. Repositories own feature-specific SQL and persistence mapping. Keep SQL
out of controllers and avoid generic repository/base-service frameworks.

Cross-feature calls must use an explicit exported provider or a small stable
feature contract. Do not introduce cycles, import another feature's private
files, or make Account depend on Authentication. `common/` is not a place for
feature code: promote code there only when multiple bounded contexts use the
same behavior and ownership is genuinely shared.

Choose names from the business feature (`identity/account`,
`learning/progress`, `execution/outbox`). Avoid duplicate paths such as
`health/health/` and module-root folders named only after technical concerns.
Keep composition modules small and do not add pass-through abstractions that
have no policy, lifecycle, or substitution value.

## 20. Coding and API contract rules

- Use strict TypeScript types. Do not add `any`, `@ts-ignore`, or unchecked
  casts to bypass a contract; narrow external input at the boundary.
- Use `import type` for type-only dependencies and do not read `process.env`
  outside configuration parsing, application bootstrap, or isolated tests.
- Validate request DTOs explicitly, reject unknown fields, and document the
  actual response/error shape in OpenAPI. Map persistence errors at the owning
  feature boundary; never return raw SQL or driver errors.
- Return explicit public representations. Do not serialize database rows,
  password hashes, session token hashes, or internal security metadata.
- Keep methods focused on one use case. Avoid controller business logic,
  god services, speculative event buses, magic decorators, and duplicated
  session/authentication logic.
- Add comments or JSDoc to public behavior-bearing APIs when they clarify
  security, lifecycle, or business semantics. Do not add comments that merely
  restate the code.
- Never log passwords, raw session credentials, learner source, or other
  sensitive payloads. Unexpected errors must be normalized by the shared HTTP
  error contract.

## 21. Docker development and production

`Dockerfile` has named `development` and `production` targets. Intermediate
dependency/build stages are implementation details of those targets.

`compose.yaml` is for local development only. It must select the `development`
target, provide PostgreSQL for local use, bind-mount the source, use a named
`node_modules` volume, and pass the host UID/GID so generated files stay owned by
the developer. It must not define production deployment behavior or make
Kafka, Redis, Engine, mail, or other inactive infrastructure a startup
dependency.

Always set an explicit `stack-atlas-api` Compose project/resource namespace.
Repositories with the same directory basename can otherwise collide on a
default project name. Preserve the namespaced project, containers, network, and
volumes. Never remove volumes or run `docker compose down -v` as part of normal
verification.

The production image must be reproducible from the lockfile, contain compiled
application output and the runtime migration files/tooling, run as a fixed
non-root user, and contain no development bind mounts or local secrets. Apply
migrations as an explicit deployment/release step; do not hide destructive
migration behavior in container startup. Keep `.dockerignore` aligned with
production build needs while including required migration assets.

## 22. CI and image publishing

The canonical CI workflow must run dependency installation from the lockfile,
build, typecheck, lint, unit tests, PostgreSQL-backed migration/integration
tests, and HTTP end-to-end tests. Database tests must use a real PostgreSQL
service and verify migrations from an empty database. Do not substitute SQL
mocks for database invariants.

Pull requests build the production Docker target without publishing it. Image
publishing is gated on the full CI job and is limited to the configured
`main`, `develop`, and version-tag triggers. Grant package-write permission
only to the publishing job. Do not configure a deployment environment or
credentials until a concrete deployment target is part of the task.

Keep CI workflows and image tags consistent with package identity
`stack-atlas-api`. Do not add a Kafka/Redis service to CI unless an active
feature has an integration contract that requires it. Local Compose remains
development-only; CI and release builds use the production Docker target.

## 23. Verification for platform and delivery changes

For Docker/CI/migration-runner changes, run the repository-equivalent checks:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run migrate
npm run test:integration
npm run test:e2e
npm run build
docker compose config --quiet
docker build --target production .
```

When verifying local Compose, inspect the resolved project name and published
ports first. If a local port is occupied, override only the host port; do not
stop or recreate another repository's containers. Report checks that could
not run and their concrete environmental reason.
