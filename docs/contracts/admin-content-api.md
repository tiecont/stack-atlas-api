# Admin Content HTTP API

The API owns the persisted Content Document V1 contract and exposes structured
content data. It never renders authored content to HTML. Web validates and
renders the document with its own Content Document V1 mirror and renderer.
Web Git remains the canonical authored source until a separately approved
cutover; these HTTP endpoints do not import Git content or dual-write it. A
separate operator CLI imports from a clean, pinned Web commit without changing
Web runtime reads; see
[`../operations/git-content-import.md`](../operations/git-content-import.md).

All routes are under `/api/v1`. Admin routes require an active session cookie
and resolve permissions from PostgreSQL for every request. Mutating requests
also require an allowed `Origin`. Admin and public slug lookup responses use
`Cache-Control: no-store`. Public search returns only published summaries and
may be cached for 60 seconds.

## Routes

| Method | Route                                      | Permission        | Result                                       |
| ------ | ------------------------------------------ | ----------------- | -------------------------------------------- |
| `GET`  | `/admin/content`                           | `content:read`    | Filtered, cursor-paginated items             |
| `POST` | `/admin/content`                           | `content:create`  | New item and its first draft revision        |
| `GET`  | `/admin/content/:id`                       | `content:read`    | Item metadata                                |
| `GET`  | `/admin/content/:id/revisions`             | `content:read`    | Cursor-paginated revision summaries          |
| `GET`  | `/admin/content/:id/revisions/:revisionId` | `content:read`    | Structured revision for preview              |
| `POST` | `/admin/content/:id/revisions`             | `content:update`  | Append a draft revision                      |
| `POST` | `/admin/content/:id/submit-for-review`     | `content:update`  | Move `DRAFT` to `IN_REVIEW`                  |
| `POST` | `/admin/content/:id/publish`               | `content:publish` | Publish a revision from `IN_REVIEW`          |
| `POST` | `/admin/content/:id/archive`               | `content:archive` | Archive an item without deleting history     |
| `GET`  | `/content/search?q=:query`                  | Public            | Up to 20 matching published article summaries |
| `GET`  | `/content/:slug`                           | Public            | Active published content by URL-encoded slug |

The review route exposes the lifecycle transition required before publish.
Publishing remains a separate command so the permission and atomic publication
record are applied at that boundary. Returning an item to draft or restoring an
archived item remains available through the lifecycle service and is not part
of this HTTP surface.

Create accepts `contentKey`, `slug`, and a validated Content Document V1
`document`. New article writes persist a canonical slug with exactly
`articles/<domain>/<slug>`; `domain` and the final segment use lowercase
ASCII letters, digits, and single hyphens. Create normalizes case and
whitespace before checking that route shape, but it never invents a route
prefix. Revision append accepts a required `baseRevisionId` and `document`.
The authenticated principal supplies creator, reviewer-transition, publisher,
and archiver identity; request bodies cannot select an actor. Cursor and page
size are bounded, and list status filters use the lifecycle enum.

During the A01.1 transition, historical rows may still store non-canonical
slugs until A01.2 remediation. Admin item, revision, and lifecycle responses
return that persisted route identity as stored. Public lookup, search, and
catalog projections expose canonical article routes only; this filtering
does not change or archive historical rows.

## Concurrency And Publication

Revision append runs in one PostgreSQL transaction. It locks the content item,
requires `DRAFT`, compares `baseRevisionId` with `latest_revision_id`, inserts
the next immutable revision, and updates the latest pointer. A stale base
returns `409` with code `content_revision_conflict`; no revision is inserted.

Publish validates the selected immutable revision and lifecycle, then in one
transaction locks the item, verifies that the revision belongs to it and that
the state is still `IN_REVIEW`, appends publication history with actor and
timestamp, and updates the published pointer and state. A foreign revision
returns `404`; a stale lifecycle transition returns `409`. Publish also
requires the stored item to have the canonical article route; a historical
non-canonical slug returns `409 content_route_not_publishable` before any
publication row or state change. The service checks this route before entering
the existing locked publication transaction. Any later route-mutation feature
must revalidate route eligibility under locking compatible with publication.

Public reads require both `status = 'PUBLISHED'` and a non-archived item with a
revision matching its published pointer. There is no fallback to the latest
draft. Archiving preserves revision and publication history while removing the
item from public lookup. Public search uses that same published pointer,
searches the slug and document text, ranks title matches first, bounds the query
to 160 characters, and returns at most 20 canonical-route summaries without
document bodies. Public catalog article, path membership, relation, and
article-redirect projections use the same canonical-route eligibility rule.
Public lookup accepts only a URL-encoded canonical article slug. Malformed or
non-article route shapes return `400 invalid_content_route`; a valid
canonical route that is missing, unpublished, or archived keeps the existing
`404 content_not_found` behavior.

## Errors

Errors use RFC 9457 Problem Details with `application/problem+json`. Admin
operations document `400` validation failures, `401` missing/invalid session,
`403` missing permission, `404` missing item or item-owned revision, and `409`
identity/slug conflict, stale revision, or invalid lifecycle state. Public
slug lookup documents `400 invalid_content_route` with the message
`The article route must match articles/<domain>/<slug>.` and `404`
unpublished, missing, or archived content. Publish documents
`409 content_route_not_publishable` with the message
`The content item does not have a canonical public article route.` Both route
problems are non-retryable. Public search documents `400` invalid or oversized
queries. Database driver messages are not returned.

## Existing-Data Route Preflight

Run `npm run content:route-preflight` before planning persistence tightening.
The command reads every article identity and route in a read-only PostgreSQL
transaction, prints a summary, and writes a machine-readable JSON report under
`content-route-preflight-reports/` by default. It classifies malformed and
legacy-generated routes, reports non-authoritative suggestions for safe
two-segment legacy values, and detects suggestion collisions with canonical
active or archived owners and with other suggested routes.

The command never changes a content item, publication, or catalog snapshot.
Every non-canonical stored row, including archived history, is a blocker
because it would fail a global exact-route constraint. Exit status is `0`
when there are no blockers, `1` when blockers are reported, and `2` for
configuration or runtime failure. Do not tighten the database constraint or
apply route remediation until the report has been reviewed and each blocker
has an explicit decision.

A01.1 does not add the final database route constraint, automatic route
backfill, or route-history redirects. A01.2 owns approved route remediation,
route mutation, redirects, and persistence tightening.

## Persistence Changes

The API adds nullable `content_publications.published_by` with a user foreign
key so historical publication rows remain valid, and an index on
`content_items(created_at DESC, id DESC)` for keyset listing. New publications
always record the authenticated publisher. No migration rewrites content
documents or changes revision/publication immutability.
