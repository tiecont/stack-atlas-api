# Platform authorization

Owner: Identity / Platform Authorization. Previously authenticated accounts had
no platform permissions. This phase introduces a fixed permission vocabulary and
three fixed platform roles, without organizations or resource ACLs.

## Pre-implementation invariants and acceptance

Actor: opaque-session AuthenticatedPrincipal -> current database assignments ->
platform-owned administrative capability -> active session/account existence ->
all permissions required by the route. SessionAuthGuard must run before
PermissionGuard. No request-body identity or cached/token permission claims are
used. Missing authentication is 401; insufficient permission or missing route
permission metadata is 403. Role revocation applies on the next permission read.
Permissions are resolved as a distinct union across assigned roles.

Tables: platform_roles (text primary key), platform_role_permissions (composite
role/permission key), user_platform_roles (composite account/role key and grant
timestamp default now()). Columns are non-null. Foreign keys reference roles and
users; permission and role CHECK constraints close the vocabulary. Assignment
primary key indexes account reads; a role index supports FK checks. Existing
accounts receive no roles. Migration creates new tables and reference role maps;
it does not scan or modify account data. FK creation takes a brief lock on users.
Permission query cardinality is at most six distinct rows per account.

Transaction: REQUIRED for grant/revoke. Entry point is
PlatformAuthorizationService.changeRoleAssignment -> repository transaction:
lock target account FOR KEY SHARE, verify existence, insert ON CONFLICT DO NOTHING
or delete exact assignment, commit. Composite account/role key gives idempotency;
READ COMMITTED and row/FK locking prevent grants to concurrently deleted accounts.
No external side effects; failures roll back the assignment. Inspection and
permission checks are read-only; Transaction: NOT REQUIRED (single SQL snapshot).
The CLI is a deliberate database-operator boundary, not an HTTP grant API.

Acceptance: unit tests prove vocabulary validation and fail-closed guard policy;
PostgreSQL tests prove role union, assignment idempotency, FK/check constraints,
and rejected writes without data changes; HTTP tests prove 401/403/allowed,
same-session role revocation, unrelated-account denial, and session revocation.
CLI tests prove preflight/verify are read-only and apply requires confirmation.

## First administrator and role operations

There is no implicit first-account promotion, development seed, hard-coded
identity, or HTTP grant endpoint. An operator with access to the configured
`DATABASE_URL` must select the existing account UUID and a fixed platform role.
Use the immutable release image or run `npm run build` from the source checkout.
Apply schema migrations first, then run the read-only preflight:

```sh
npm run migration:preflight
npm run platform:authorization -- preflight \
  --account-id <account-uuid> --role platform-admin --operation grant
```

Apply requires a confirmation string that repeats the exact target, role, and
operation. The command verifies the persisted result after the transaction:

```sh
npm run platform:authorization -- apply \
  --account-id <account-uuid> --role platform-admin --operation grant \
  --confirm <account-uuid>:platform-admin:grant
npm run platform:authorization -- verify \
  --account-id <account-uuid> --role platform-admin --operation grant
```

The same flow accepts `--operation revoke`. The primary key makes duplicate
grants no-ops; deleting an absent assignment is also a no-op. Preflight and
verify only inspect current state. Apply uses one transaction, locks the target
account against deletion, changes one assignment, commits, then performs a
separate read to verify. A failure before commit rolls back; a failure during
post-apply verification reports an error without attempting an unsafe automatic
compensation. Re-run verify and, if needed, run a separately confirmed revoke or
grant. The command prints the account UUID and role, never session credentials.

HTTP features must apply `SessionAuthGuard` before `PermissionGuard` and declare
requirements with `@RequirePermissions(PLATFORM_PERMISSION.CONTENT_READ)` (or
the appropriate exported permission constant). This phase adds no content
authoring controller and no organization or resource ACL model.

Failures follow existing Problem Details: about:blank/401 Unauthorized for missing
session, about:blank/403 Forbidden for denied permission, 400 Bad Request for
invalid operator inputs, 404 Not Found for missing grant target, and sanitized
500 Internal Server Error for unexpected database failure. Denials are not
retryable without changing identity/permissions; database failures may be retried
after investigation. No permission-check writes or partial grant writes occur.
