# Git Content Import

The importer is an explicit operator command for moving published articles and
their supplemental catalog snapshot from Web Git into API/PostgreSQL. It does
not switch Web filesystem runtime reads, remove source files, or create a
synchronization job. Web Git remains canonical until a separately approved
catalog cutover.

The API persists article identity, slug, Content Document V1, immutable
revision, and publication history. A separate immutable snapshot preserves
site, topic, category, path/module, relationship, and legacy redirect metadata
from the exact source commit. The report retains unsupported HTML and
unresolved references. Executable or invalid content prevents apply from
activating the snapshot. SVG is retained as inert code and called out in the
report. Imported creator and publication timestamps identify the operator and
import time, not the historical Git author or original publication time.

## Preconditions

- Use a clean checkout of `tiecont/stack-atlas` at the intended merged `main`
  commit. The command records `HEAD` and rejects another Git origin or a dirty
  worktree.
- Build the API so `dist/` contains the importer and catalog services:

  ```sh
  npm ci
  npm run build
  ```

- The operator supplies an existing account ID and active session ID. The API
  resolves current permissions from PostgreSQL and checks that the session
  belongs to that account and has not expired or been revoked. `dry-run` and
  `verify` require `content:read`; `apply` also requires `content:create`,
  `content:update`, and `content:publish`.
- Obtain the active session ID with a read-only lookup for the operator account:

  ```sql
  SELECT id
  FROM stack_atlas.sessions
  WHERE user_id = '<operator-account-uuid>'
    AND revoked_at IS NULL
    AND expires_at > now()
  ORDER BY expires_at DESC
  LIMIT 1;
  ```

  The session ID is not a bearer token. Never query or expose `token_hash`.
- Keep reports as migration evidence. The default destination is the ignored
  `content-import-reports/<source-sha>/` directory; pass `--report-dir` to use
  the approved evidence store.
- The production image includes the importer CLI. Run it with a clean Web
  checkout and report directory mounted read-only and writable, respectively:

  ```sh
  docker run --rm --network <database-network> \
    --mount type=bind,src=/absolute/path/to/web,dst=/source,readonly \
    --mount type=bind,src=/absolute/path/to/reports,dst=/reports \
    --env DATABASE_URL \
    <immutable-api-image> \
    npm run content:git-import -- dry-run --source /source \
      --account-id <operator-account-uuid> \
      --session-id <active-session-uuid> \
      --report-dir /reports
  ```

  Replace `dry-run` with `apply` or `verify` as appropriate. `apply` also
  requires `--confirm <exact-source-sha>`.

## Preflight

Run dry-run against the exact source checkout:

```sh
npm run content:git-import -- dry-run \
  --source ../web \
  --account-id <operator-account-uuid> \
  --session-id <active-session-uuid>
```

The command writes JSON and Markdown reports with the repository, exact source
SHA, per-file SHA-256 inventory, article results, catalog checksum/status,
unsupported constructs, and relationship mismatches. Review all warnings and
gaps. A nonzero exit or any failed article blocks apply. An apply also refuses
to activate a snapshot with unresolved catalog references. Warnings may
describe content intentionally flattened or represented as inert code; decide
that each is acceptable before applying.

## Apply

Use the SHA printed in the dry-run report as the explicit confirmation:

```sh
npm run content:git-import -- apply \
  --source ../web \
  --account-id <operator-account-uuid> \
  --session-id <active-session-uuid> \
  --confirm <exact-40-character-source-sha>
```

The command recomputes the snapshot and checks the confirmation before opening
the API application context or making database writes. It preflights every
article first. Any source error, permission failure, or conflicting existing
identity, duplicate published source slug, or slug owned by another active
content item prevents all writes during that preflight. Each new article, first
revision, lifecycle transitions, publication record, and published pointer
then commits in one PostgreSQL transaction per article. After all article
writes succeed, the immutable catalog snapshot and active-snapshot pointer are
written together in a separate transaction. Processing stops at the first
write failure; items committed earlier remain committed and later items are
marked skipped. There is no whole-source transaction.

## Idempotency And Recovery

An existing `content_key` is accepted as already imported only when its slug,
published state, latest/published revision pointer, and latest revision
checksum match the source document. A mismatch is reported and never
overwritten. If a write fails after earlier items committed, rerun the same
source SHA after resolving the reported cause. Matching items become no-ops
and the remaining items resume. A concurrent import may report a deterministic
identity conflict; rerun after the other command completes.

The importer does not delete or rewrite items, revisions, publication history,
or stored catalog snapshots. Activating a later source SHA changes only the
active-snapshot pointer after preflight succeeds. For incorrect content, stop
imports and use the normal authorized content lifecycle or the documented
incident recovery process. Do not edit immutable rows directly. Applying a
snapshot requires the catalog schema migration to be present.

## Verification

After apply, run verify against the same source checkout and retain its report:

```sh
npm run content:git-import -- verify \
  --source ../web \
  --account-id <operator-account-uuid> \
  --session-id <active-session-uuid>
```

Verification checks every importable published article against its content
identity, slug, published state, latest/published revision pointer, and
canonical V1 checksum. It also checks that the active snapshot has the same
source SHA and catalog checksum. Missing or changed records fail the command.
This verifies API persistence only; it does not switch Web reads. Before the
Web filesystem runtime is removed, compare the API catalog response with the
same Web commit for article/topic/path counts, ordering, URLs, relationships,
redirects, search, and SEO, then retain both the dry-run and verify reports.
