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
    identity/
      authentication/
      account/
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
