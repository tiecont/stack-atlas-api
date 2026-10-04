# Content Route Preflight

## Purpose

The route preflight measures existing Content V1 article slugs before a later
schema change enforces the exact `articles/<domain>/<slug>` route contract.
It identifies invalid routes and deterministic suggestion collisions so
operators can decide remediation before persistence is tightened.

## Read-only guarantee

`npm run content:route-preflight` reads only article identity, route, status,
archive timestamp, and published revision pointer columns from
`stack_atlas.content_items`. The repository runs the query inside a PostgreSQL
transaction marked `READ ONLY`. The command does not change content rows,
revisions, publication history, lifecycle, redirects, or catalog snapshot
activation. It does write a local JSON report file.

## Run

Build the API and run the command with the environment's normal database
configuration:

```sh
npm run build
npm run content:route-preflight
```

To choose another report directory:

```sh
npm run content:route-preflight -- --report-dir /path/to/reports
```

The default report directory is `content-route-preflight-reports/`. Reports
contain article IDs, content keys, route values, lifecycle state, classifications,
suggestions, and collision ownership IDs. They do not contain document bodies,
account details, database configuration, or credentials.

## Report and exit status

The terminal summary includes article totals, canonical and invalid counts,
invalid published/draft-review/archived counts, suggestion collisions, and
blockers. The JSON report includes the same summary, one classified record per
article, and each suggested-route collision. A suggestion is explicitly marked
non-authoritative and is never applied.

- `0`: no blocking route violations.
- `1`: one or more non-canonical rows or blocking suggestion collisions.
- `2`: argument, configuration, database, or runtime failure.

Archived invalid rows are blockers because a future global route constraint
would reject them too. A collision with an archived canonical owner is reported
as a warning about future restore ownership; no owner is selected.

## A01.2 gate

Do not tighten the database route constraint or apply remediation while the
report has blockers. Review every invalid row and collision, approve a
remediation decision, and rerun the preflight against the target environment
after remediation. The preflight does not itself establish that staging or
production data is clean unless it is actually run against that environment.

A01.2.1 adds immutable route-history storage for explicit canonical-to-
canonical Admin changes. This preflight command remains read-only and does not
create route history, repair existing rows, or rewrite a catalog snapshot.
A01.2.2 remediation requires a target-environment inventory and an approved
canonical mapping for each invalid row. A01.2.3 persistence tightening remains
blocked until a post-remediation target-environment preflight is clean. No
automatic backfill or final global canonical route constraint is part of
A01.2.1.
