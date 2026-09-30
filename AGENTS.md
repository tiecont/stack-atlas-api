# Stack Atlas API — Agent Instructions

Canonical execution rules for `stack-atlas-api`, the NestJS business and
control-plane service. Read before planning, reviewing, or changing code. A
closer `AGENTS.md` may add stricter rules but must not weaken these invariants.

**MUST / MUST NOT** are merge blockers. **SHOULD / SHOULD NOT** are defaults;
a deviation needs a concrete repository-specific reason. Preserve unrelated
user changes.

## 1. Mandatory pre-work

Before editing:

1. Identify the bounded context and named feature that own the behavior.
2. Inspect its module, service, repository, DTO, migration, and tests as
   applicable; follow the nearest established feature pattern.
3. Classify authorization, API, persistence, migration, lifecycle, event,
   integration, or delivery risk.
4. For authorization, write the actor, resolved context, resource owner, state,
   and permission. For a query/schema change, record affected tables/columns,
   nullability/defaults/constraints/indexes, existing-data impact, result
   cardinality, and lock risk. For each write, state `Transaction: REQUIRED`
   or `Transaction: NOT REQUIRED` with a reason. If required, name its entry
   point, operations inside/outside, idempotency key, isolation/locking,
   side-effect order, and rollback behavior.
5. Identify the focused unit, PostgreSQL integration, contract, or HTTP test
   that proves the changed invariant.

For non-trivial work, record current behavior, target behavior, invariant,
owner, and objectively verifiable acceptance criteria before implementation.
Do not perform unrelated cleanup or destructive broad resets.

## 2. Architecture rules

### ARCH-001 — Feature owns business behavior

Business files MUST belong to a named feature under
`src/modules/<context>/<feature>/`. Keep the feature composition module at that
root and implementation in only the layer directories that contain real code:
`controllers/`, `services/`, `repositories/`, `entities/`, `dto/`, `guards/`,
`helpers/`, `errors/`, `constants/`, or `types/`.

Do not create technical layer folders directly under a bounded context, empty
future features, duplicate paths such as `health/health/`, or module-root
`services/` and `repositories/` directories. New bounded contexts require an
active roadmap phase.

Identity v1 ownership is fixed:

- Account owns registration and account persistence.
- Session owns session persistence and lifecycle.
- Authentication owns login, logout, authenticated principal, and the
  current-account route.
- Account MUST NOT depend on Authentication.

### ARCH-002 — Dependency direction

Use `HTTP controller -> feature application service -> feature repository ->
database`. Controllers validate/translate transport input and response only;
services own one use case and its policy; repositories own feature SQL and
persistence mapping. Keep SQL out of controllers and business policy out of
repositories.

Cross-feature calls MUST use an exported provider or a small stable feature
contract. Do not import another feature's private files or create a cycle.
Reusable origin enforcement belongs in `common/http/security/` and MUST NOT
create a feature-module cycle.

Each business command/use case has exactly one owning feature service. HTTP
controllers, event consumers, and maintenance scripts are adapters: validate
their boundary, resolve authority, then call that owner. They MUST NOT duplicate
the transition or write repositories directly to bypass service policy.

### ARCH-003 — Complex repeated behavior

When a non-trivial business operation, resolution policy, or context-building
step is needed by two or more features/services, extract it from the main use
case services into one focused component such as `ResolverService` or
`ContextService`.

The extracted component MUST own the decision/resolution rules, define explicit
inputs and outputs, and have focused behavioral tests. Callers delegate to it;
they MUST NOT keep duplicate copies of the rules. Keep one-off logic local.
Do not extract a pass-through wrapper, generic base service, or a component
without a real second consumer. Keep domain behavior in its owning feature;
move it to `common/` only when it is genuinely domain-neutral and shared.

## 3. Data ownership and product phase

### DATA-001 — PostgreSQL owns operational state

PostgreSQL is the transactional source of truth for accounts, sessions,
enrollments, progress, attempts, submissions, execution jobs, result
application, and active administrative state. Add organizations, entitlements,
or other future domains only when their roadmap phase starts.

Redis MAY accelerate cache, counters, or fanout; it MUST NOT be the only durable
record of progress, submissions, or entitlements. MongoDB is not a default
store; adoption requires a documented workload and explicit ownership.

### DATA-002 — Authored-content source

Until an explicit authored-content cutover, Web Git remains canonical for
article bodies, learning paths, exercise definitions, and assessment
definitions. The API may establish content identity, immutable revisions,
publication history, and validation as a persistence foundation. It MUST NOT
dual-write authored content, expose learner reads, or make PostgreSQL the
content source before that cutover.

The API owns persisted Content Document V1. Its canonical contract is
`docs/contracts/content-v1.md`: document blocks use the
`{ id, type, version: 1, props }` envelope with the eight documented block
types; paragraphs, lists, and inline formatting belong in
`rich_text.props.nodes`. Web mirrors the contract independently, and both
repositories MUST keep their canonical JSON fixture semantically identical.
Revision append MUST require `baseRevisionId` and reject stale or competing
writes while holding the content-item row lock.

Treat `docs/contracts/content-v1.md` as the persisted schema authority. Keep
validation exact-key at the document, block envelope, block props, rich-text,
and inline-node levels. Block ids are required, unique within a document, and
never generated in a repository. Block version is exactly `1`; unsupported
types or versions fail validation. A heading's optional anchor is
`props.anchor`, never its block id. Reject executable URL schemes, protocol-
relative URLs, and URL credentials. Keep the documented document, block,
depth, code-byte, table, related-item, and URL limits aligned with the
independent Web validator. The API fixture is
`test/fixtures/content/content-document-v1.json`; Web keeps its own copied
fixture, and neither repository imports source or fixtures from the other.

Contract tests MUST exercise the canonical all-block fixture, unknown fields
and versions, duplicate ids, unsafe URLs, and size limits. Checksum tests MUST
prove key-order-independent output. PostgreSQL integration coverage MUST prove
stale-editor conflict with no extra revision and one-winner/one-conflict
behavior for concurrent appends from the same base, including the latest
pointer and revision count.

Content lifecycle is `DRAFT`, `IN_REVIEW`, `PUBLISHED`, or `ARCHIVED`; use the
central transition policy in the catalog service. Revision append is allowed
only in `DRAFT`, publication only from `IN_REVIEW`, and archive hides content
from public lookup without deleting revisions or publication history. Resolve
`created_by`, revision creator, and archive actor from `AuthenticatedPrincipal`;
never accept actor IDs from content input. Slugs must follow
`docs/contracts/content-v1.md`, protect reserved route roots, and be unique for
non-archived content. Keep lifecycle operations behind current typed platform
permissions even while their HTTP controllers remain unexposed.

## 4. Authorization and learning invariants

### AUTH-001 — Server-authoritative ownership

Authentication establishes identity; authorization is decided by the server.
Never accept a request user ID as ownership or an organization ID as authority.
When immediate revocation matters, resolve account status and permissions from
current database state rather than stale token claims.

For every protected mutation, identify the principal, resolved context,
resource owner, required lifecycle state, and permission before implementation.
Test unauthenticated, forbidden, wrong-owner, and revoked-access cases that
apply to the endpoint. Never expose passwords, token values/hashes, or internal
security metadata.

Platform administration uses only the typed permission vocabulary and
platform-owned roles. Resolve grants from PostgreSQL on each protected request;
never authorize from request-body identity, email, UUID constants, or frontend
state. SessionAuthGuard must run before PermissionGuard. Role grants/revokes
require the explicit `platform:authorization` operator command; account
registration or first login MUST NOT auto-promote an account.

### LEARN-001 — Evidence is not mastery

Keep `read`, `checkpoint passed`, `practiced`, `applied`, and `verified later`
evidence distinct. A canonical article may occur in several learning paths.
Persist progress against article identity; keep path-specific resume context
separate. Reading MUST NOT imply mastery.

## 5. Database and migration rules

### MIG-001 — Timestamp identity — BLOCKER

Before creating a migration, MUST run:

```sh
date +%s%3N
```

Use that exact 13-digit Unix-millisecond value. If it already exists, rerun
`date +%s%3N`; never alter the value by hand. The migration filename is
`<timestamp>-<Description>.ts`; the class name is `<Description><timestamp>`
and implements `MigrationInterface`.

For example, the file/class pair must follow this shape:

```text
<timestamp>-AddAccountStatus.ts
AddAccountStatus<timestamp> implements MigrationInterface
```

MUST NOT invent, round, copy, increment, or derive a timestamp from a release
date. Do not use relative sequence numbers or rely on directory order. The
timestamp is the creation identity.

### MIG-002 — Feature ownership

New migrations MUST live beside their owning feature:

```text
src/modules/<context>/<feature>/migrations/
```

The feature is the owner whose persistence contract changes. Cross-feature
schema changes still need one explicit owner. `src/database/migrations/` is not
a valid location for new feature migrations.

Keep already deployed root migrations in place as history; do not move, rename,
or edit them. The migration runner must support both this legacy history and
new feature migration folders.

### MIG-003 — Dual-history migration runner

The runner preserves deployed root `node-pg-migrate` history and applies new
timestamped TypeScript migrations compiled under their owning feature. The
legacy JavaScript files are immutable compatibility history; new migrations
MUST use the feature-owned TypeScript format from MIG-001/MIG-002.

`npm run migration:create -- <context> <feature> <PascalCaseDescription>` is
the supported generator. It creates a feature-owned schema migration and checks
the generated timestamp for uniqueness. Do not create a new root legacy file or
a TypeORM migration that this runner cannot execute.

### MIG-004 — Schema migration vs data migration

Schema changes belong in `<feature>/migrations/`. Business transformations
and backfills belong in `<feature>/data-migrations/`. `npm run migrate` applies
legacy and schema migrations only. Run `npm run migration:data-up` as an
explicit release step after all legacy and schema migrations are applied;
`npm run migration:preflight:data` checks that prerequisite without writing.
Data migrations SHOULD be idempotent when practical and MUST have PostgreSQL
integration coverage for important invariants. Seeds are only for
reference/bootstrap data. Large or resumable backfills that need batching,
progress reporting, or a dry run MUST use a dedicated `scripts/<context>/<feature>/`
command instead of one long transaction in the migration runner.

### MIG-005 — Destructive evolution

Use:

```text
expand -> backfill/cutover -> verify -> contract -> cleanup
```

Do not drop legacy columns/tables while an older application version may still
run. Contract migrations MUST verify prerequisites before tightening
constraints. Backfills MUST check collisions/invalid rows before changing data
and preserve rows if a precondition fails.

### MIG-006 — Deterministic SQL and rollback

Each migration MUST implement deliberate `up(queryRunner)` and
`down(queryRunner)` behavior using migration-local SQL and metadata. Do not
import Nest services, repositories, runtime configuration, or application
providers into a migration. Keep each migration scoped to one persistence
change and preserve valid account, authorization, and lifecycle state unless
that change is the migration's explicit purpose.

Once a migration reaches a shared or deployed environment, do not edit, rename,
reorder, or reuse its identity. Add a new migration. An unshared branch
migration may be corrected before merge; update its filename, class, tests, and
references together.

Do not set a global PostgreSQL statement timeout without a measured workload
need and validated typed configuration.

### MIG-007 — Required verification

Every migration change MUST pass and CI MUST run:

```sh
npm run migration:check-timestamps
npm run migration:verify
npm run test:integration
```

`migration:verify` MUST apply legacy migrations, schema migrations, and then
data migrations to an empty PostgreSQL database; it MUST verify applied counts
by kind and roll all three groups back in a disposable database. CI MUST run
this verifier, timestamp validation, PostgreSQL integration tests, and HTTP
e2e tests. PostgreSQL test suites MUST use separate databases for destructive
migration/integration work and HTTP e2e work. The disposable migration verifier
and test-database creator MUST refuse non-local PostgreSQL hosts.
Feature migration tests MUST verify schema constraints and data invariants;
important backfills must verify failure-without-data-loss on invalid input.
Never substitute SQL mocks for PostgreSQL migration invariants. Report the
exact command and environmental reason when a required PostgreSQL check cannot
run. A required database suite MUST fail when its URL or destructive-test
opt-in is missing; it MUST NOT be silently skipped. PostgreSQL tests MUST
refuse non-local hosts and database names outside the explicit Stack Atlas test
database allowlist.

## 6. API and error contracts

### API-001 — Validate the boundary

DTOs MUST validate applicable UUIDs/IDs, enums, string lengths, numeric bounds,
array size, uniqueness, and filter/sort allowlists. Reject unknown request
fields. Never accept raw SQL fragments or client-supplied ownership as
convenience input.

### API-002 — Explicit wire representation

Use feature DTOs for responses. Do not serialize database rows or ORM entities
when they contain password hashes, token hashes, internal ownership, audit, or
security fields. Keep OpenAPI aligned with the actual success and Problem
Details error shape. Map PostgreSQL/driver failures at the owning feature
boundary; never return raw SQL or driver messages.

Use strict TypeScript, `import type` for type-only imports, and narrow external
input at the boundary. Do not add `any`, `@ts-ignore`, unchecked casts, or
`process.env` reads outside configuration parsing, application bootstrap, and
isolated tests. Use `unknown` for untrusted values, narrow them explicitly,
and handle unions exhaustively. Public services/helpers need explicit return
types; avoid non-null assertions unless the invariant is proven locally.

For every new failure branch, define its condition, stable Problem Details
code/type, HTTP status, public message, retryability, and transaction outcome.
Unexpected errors use the shared Problem Details contract; never return raw
database messages.

## 7. Submission and event rules

### EXEC-001 — Atomic idempotent submission creation

A submission references an immutable exercise version and supports a client
idempotency key. In one PostgreSQL transaction, persist the submission,
execution job, and outbox event; commit all three or none. Do not use a direct
DB insert followed by Kafka publish as the consistency mechanism.

### EXEC-002 — Valid state transitions

Allow only `DRAFT -> QUEUED -> RUNNING ->` one of `PASSED`, `FAILED`,
`COMPILE_ERROR`, `RUNTIME_ERROR`, `TIMEOUT`, or `SYSTEM_ERROR`. Reject invalid
and stale terminal transitions. The API never executes learner code.

### EXEC-003 — Versioned at-least-once events

Publish `execution.requested.v1` from the outbox. Use the API-owned shared
envelope fields: `event_id`, `event_type`, `schema_version`, `occurred_at`,
`correlation_id`, optional `causation_id`/`traceparent`, `producer`, and `data`.
Never put secrets or learner credentials in events.

Assume at-least-once delivery. Result consumers validate version/schema,
deduplicate by event identity, and preserve submission/execution/trace IDs.
The API owns result application; Engine MUST NOT mutate progress.

### EXEC-004 — Transactional result application

For a result event, validate the contract before mutation, deduplicate it, and
reject stale terminal updates. In one transaction, apply the valid submission
and attempt transition. Update learning/mastery only after that durable
transition succeeds. Duplicate or stale results MUST NOT produce duplicate
learning evidence.

## 8. Tests and change checklists

### TEST-001 — Required service sidecars and shared flow tests

Every production `*.service.ts` file MUST have one adjacent
`<service-name>.service.spec.ts` containing focused behavior tests for that
service. The normal `npm test` command MUST discover these sidecars, and
`npm run test:structure` MUST fail when a service sidecar is missing.
Sidecars are unit tests for the owning service; they do not replace tests of
database or HTTP invariants.

These service unit sidecars are the only tests allowed under `src/`.

Business-flow, PostgreSQL integration, contract, acceptance, and HTTP e2e tests
MUST live in the shared `test/<context>/<feature>/` tree, grouped by feature.
Cross-feature PostgreSQL migration/infrastructure tests belong in
`test/integration/`; cross-feature HTTP contract tests may live in
`test/http/`. Never put full-flow, integration, or e2e tests under
`src/modules/<context>/<feature>/`. Do not create a parallel top-level `tests/`
directory or tests whose only assertion is that a file imports or a provider
exists.

Every bug fix MUST have a regression test at the narrowest boundary that
reproduces it. Each test states setup, action, and observable result. Database
invariants use PostgreSQL rather than a mock of the behavior under test.

### TEST-002 — Required flow coverage

Cover relevant happy path, invalid input, authentication/authorization denial,
wrong ownership, invalid lifecycle transition, idempotency/duplicate delivery,
and rollback/atomicity. Critical auth, progress/quiz, submission, and result
application changes SHOULD include HTTP/module or PostgreSQL-backed flow tests;
unit mocks do not replace a database invariant test.

Each business flow MUST have shared feature tests that cover its relevant happy
path and failure cases. Name HTTP/API contract tests and browser acceptance
tests according to the boundary they exercise; rendering a login page alone
does not count as testing registration or authentication. Cross-repository
browser-to-API acceptance tests belong in a dedicated integration gate once
the API, Web, and required contract are available; ordinary API tests MUST NOT
depend on sibling checkouts.

API unit/e2e development MUST use deterministic event fixtures or fakes and
must not require an Engine checkout. When a shared execution contract exists,
store API-owned fixtures under `test/fixtures/` and use them in contract tests.

### Change checklist — Authorization

Before coding, record:

```text
principal -> resolved context -> resource owner -> lifecycle state -> permission
```

Before completion, verify server-derived ownership, current-state revocation,
wrong-owner denial, and no sensitive response/log fields.

### Change checklist — API contract

Before completion, verify DTO validation and unknown-field behavior, explicit
response DTO, Problem Details mapping, OpenAPI, and HTTP coverage for the
changed contract.

### Change checklist — Workflow/event

Before completion, verify allowed source/target states, actor/context,
authorization, transaction boundary, idempotency behavior, duplicate/stale
event handling, and failure classification.

## 9. Observability and sensitive data

Propagate request ID, correlation ID, submission ID, execution ID, and trace
context. Measure request/error/latency, auth failures, outbox backlog, Kafka
publish failures, submission creation, and result-consumer failures. Never log
passwords, raw session credentials, tokens, learner source, or other sensitive
payloads by default.

## 10. Docker, CI, and commits

### CMD-001 — Command ownership

`package.json` is the public command registry. Run documented repository
scripts (`npm run ...`); do not bypass them with direct Nest, migration, or
database CLI invocations. Every new script MUST have one owning concern, typed
or validated arguments, documented read/write side effects, deterministic exit
status, and tests for destructive or data-changing behavior. Put feature
maintenance code under `scripts/<context>/<feature>/`; put shared tooling under
`scripts/` only when it serves multiple contexts. Keep preflight/audit commands
read-only and separate from apply/repair commands.

For data-changing commands, specify the target scope, preflight checks,
idempotency, dry-run or audit mode, confirmation requirements, partial-failure
behavior, and rollback/recovery procedure. Never make a build, test, or
application startup command perform a backfill or repair implicitly.

Use `migration:create` only through the feature-aware package script described
in MIG-003. `migrate` applies legacy and schema migrations; data migrations
require the explicit `migration:data-up` command after its preflight succeeds.

Compose is local development only. Keep the explicit project name
`stack-atlas-api`, development target, PostgreSQL, source bind mount, named
`node_modules`, host UID/GID, and namespaced containers/network/volumes. Check
resolved project and host ports before Compose verification; override only an
occupied host port. Never stop another repository's containers or run
`docker compose down -v` during normal verification. Inactive Kafka, Redis,
Engine, and mail are not startup dependencies.

`/api/v1/health` is liveness and MUST NOT query PostgreSQL.
`/api/v1/health/ready` is readiness and MUST query PostgreSQL.

The production target MUST build from the lockfile, include compiled output and
runtime migration tooling, run as a fixed non-root user, and contain no local
secrets or development mounts. Migrations run as an explicit release step, not
at container startup. Release operators MUST follow
`docs/operations/migrations.md`, use the immutable versioned image, run the
read-only preflight before apply, preserve a verified backup/recovery path for
destructive changes, and check readiness after rollout. Production rollback
uses a forward migration or the documented incident recovery procedure; do not
run `migration:down` as routine deployment recovery.

CI MUST run `npm ci`, build, typecheck, lint, unit tests and the test-placement
gate, migration timestamp checks and disposable-database verification,
PostgreSQL integration tests, and HTTP e2e tests. CI MUST create separate
disposable integration and e2e databases and set
`ALLOW_DESTRUCTIVE_TEST_DATABASE=true` only for those test jobs. Pull
requests build the production Docker target without publishing. Publishing is
gated on CI and limited to `main`, `develop`, and version-tag pushes. Keep image
identity `stack-atlas-api`; package-write permission belongs only to the
publishing job. Do not add Kafka/Redis CI services without an active contract
or deployment credentials without a concrete deployment target.

Husky is installed through `prepare` and skipped in production installs. The
pre-commit hook runs `lint-staged` and `npm run test:precommit`; either failure
blocks the commit. `lint-staged` formats/lints staged TypeScript files only.

GitHub branch protection MUST require the repository CI workflow and code-owner
review for migration, API contract, and agent-rule changes. Those settings are
repository-host controls and must be checked in GitHub. `.github/CODEOWNERS`
names the repository owner. Local hooks and this file do not enforce required
reviews or checks on their own.

## 11. Verification gates

Run checks relevant to the change and report only commands actually run:

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:integration
npm run test:e2e
```

Migration and event changes require the PostgreSQL/contract checks described
above. Docker/CI changes also require resolved Compose config and a production
target build. Report an unavailable check with its exact command and concrete
environmental reason.

## 12. Completion report

Report summary, bounded context/feature, business invariant changed,
database/migration and HTTP/event impact, tests/commands run, integration
dependency, and remaining risks.
