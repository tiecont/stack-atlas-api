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
also require an allowed `Origin`. Admin and public content responses use
`Cache-Control: no-store` so lifecycle changes are reflected without a stale
intermediary response.

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
| `GET`  | `/content/:slug`                           | Public            | Active published content by URL-encoded slug |

The review route exposes the lifecycle transition required before publish.
Publishing remains a separate command so the permission and atomic publication
record are applied at that boundary. Returning an item to draft or restoring an
archived item remains available through the lifecycle service and is not part
of this HTTP surface.

Create accepts `contentKey`, `slug`, and a validated Content Document V1
`document`. Revision append accepts a required `baseRevisionId` and `document`.
The authenticated principal supplies creator, reviewer-transition, publisher,
and archiver identity; request bodies cannot select an actor. Cursor and page
size are bounded, and list status filters use the lifecycle enum.

## Concurrency And Publication

Revision append runs in one PostgreSQL transaction. It locks the content item,
requires `DRAFT`, compares `baseRevisionId` with `latest_revision_id`, inserts
the next immutable revision, and updates the latest pointer. A stale base
returns `409` with code `content_revision_conflict`; no revision is inserted.

Publish validates the selected immutable revision and lifecycle, then in one
transaction locks the item, verifies that the revision belongs to it and that
the state is still `IN_REVIEW`, appends publication history with actor and
timestamp, and updates the published pointer and state. A foreign revision
returns `404`; a stale lifecycle transition returns `409`.

Public reads require both `status = 'PUBLISHED'` and a non-archived item with a
revision matching its published pointer. There is no fallback to the latest
draft. Archiving preserves revision and publication history while removing the
item from public lookup.

## Errors

Errors use RFC 9457 Problem Details with `application/problem+json`. Admin
operations document `400` validation failures, `401` missing/invalid session,
`403` missing permission, `404` missing item or item-owned revision, and `409`
identity/slug conflict, stale revision, or invalid lifecycle state. Public
lookup documents `400` invalid slug and `404` unpublished, missing, or archived
content. Database driver messages are not returned.

## Persistence Changes

The API adds nullable `content_publications.published_by` with a user foreign
key so historical publication rows remain valid, and an index on
`content_items(created_at DESC, id DESC)` for keyset listing. New publications
always record the authenticated publisher. No migration rewrites content
documents or changes revision/publication immutability.
