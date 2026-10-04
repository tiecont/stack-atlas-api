# Content document contract v1

This contract is owned by the API for persisted content. Web Git remains
canonical until a separately approved runtime cutover. An explicit operator
importer can populate API content tables from one clean, pinned Web commit, but
Web does not read those tables during this phase. Web maintains an independent
mirror of these semantics and must not import source files from the API
repository.

Both repositories keep independent copies of the same canonical JSON fixture:

- API: `test/fixtures/content/content-document-v1.json`
- Web: `tests/fixtures/content-document.v1.json`

## Identity and lifecycle

- `content_key` is a stable, unique, lowercase key such as
  `article:transactional-outbox`.
- New article writes use the canonical public route identity with exactly the
  form `articles/<domain>/<slug>`, for example
  `articles/architecture/transactional-outbox`. The two route segments use
  lowercase ASCII letters, digits, and single hyphens; the complete slug is at
  most 255 characters. Article writes trim surrounding whitespace, lowercase,
  replace whitespace with hyphens, and remove whitespace around `/` before
  validating. Normalization never adds or removes semantic route segments.
  Only non-archived items reserve a current slug. Once a canonical route is
  changed through the Admin route endpoint, its prior route is stored as
  immutable history and remains permanently reserved. Historical persisted
  rows may still contain non-canonical routes; Admin reads preserve those
  values and public article projections exclude them until approved A01.2.2
  remediation.
- V1 persists article content only. Other content kinds need an explicit schema
  before they are added.
- Lifecycle is `DRAFT`, `IN_REVIEW`, `PUBLISHED`, or `ARCHIVED`. Allowed
  transitions are `DRAFT -> IN_REVIEW`, `IN_REVIEW -> DRAFT`,
  `IN_REVIEW -> PUBLISHED`, `PUBLISHED -> DRAFT`, any non-archived state to
  `ARCHIVED`, and `ARCHIVED -> DRAFT`. Publishing is a dedicated operation so
  publication history and the published pointer change atomically.
- Revision append is allowed only in `DRAFT`. Publishing is allowed only from
  `IN_REVIEW`. Archive and restore require `content:archive`; the other
  workflow transitions require `content:update`.
- Archiving sets `archived_at` and `archived_by`, hides the item from published
  lookup, and preserves its revisions, publication history, and pointers.
  Restoring returns the item to `DRAFT`, clears archive metadata, and can fail
  with a slug conflict if another active item owns that route or
  `content_route_reserved` if route history reserves it. Archiving itself does
  not create route history and still permits route reuse.
- `POST /api/v1/admin/content/:id/change-route` requires `content:publish` and
  accepts `baseSlug` plus a replacement `slug`. It supports canonical-to-
  canonical changes while the item is `DRAFT`, `IN_REVIEW`, or `PUBLISHED`;
  `ARCHIVED` items must be restored first. The exact `baseSlug` is compared
  under the content-item row lock. A stale value returns retryable
  `content_route_conflict`. A successful change stores the old canonical slug
  against the content item in append-only route history and updates the
  current slug in one transaction. Repeating the current slug with a matching
  base is a no-op. Historical non-canonical current routes return
  `content_route_remediation_required`; this endpoint does not remediate them.
- Route history stores source routes against content identity, not a fixed
  destination. After `A -> B -> C`, public redirects resolve both `A` and `B`
  directly to `C`. A route source can never be reused as a current slug,
  including when restoring an archived item. Public catalog route redirects
  are exposed only while their target article is published, active, and has a
  valid published revision.
- New item creation and revisions record the authenticated principal's account
  as creator. Archive records the authenticated archiver. Actor IDs never come
  from content input. Existing rows receive a deterministic `legacy-<uuid>`
  slug; items with a published revision pointer retain `PUBLISHED` state, and
  other legacy items become `DRAFT`. Historical creator fields remain nullable
  because their actors cannot be reconstructed. These migration-generated
  slugs are historical exceptions to the canonical article route and are
  reported as preflight blockers until explicitly remediated.
- Revisions are append-only and numbered per content identity.
- Appending a revision requires the caller's `baseRevisionId`. The repository
  locks the content identity and compares it with `latest_revision_id` before
  writing.
  Stale and competing writes fail with `ContentRevisionConflictError` without
  creating a revision.
- A revision stores a validated document and SHA-256 checksum of canonical JSON.
- Publication history is append-only. The current published revision points to
  one immutable revision belonging to the same content identity.
- The operator Git importer creates published article revisions through the
  catalog service and records the source SHA and file inventory. Supplemental
  site, taxonomy, path, relationship, and redirect metadata is preserved in a
  separately validated immutable catalog snapshot. Unsupported source
  constructs and unresolved references remain explicit in the import report.
  Import does not switch Web filesystem runtime reads or delete Git content.
  See [`public-content-catalog-v1.md`](public-content-catalog-v1.md). Admin
  HTTP routes check current platform permissions and call the catalog service;
  public HTTP reads return only active published revisions. HTTP article
  responses contain structured Content Document V1 data, never rendered HTML.

## Document

The document envelope contains `schema_version`, `title`, `description`, and
`blocks`. Each block uses the versioned envelope below:

```json
{
  "id": "body",
  "type": "rich_text",
  "version": 1,
  "props": {
    "nodes": [
      {
        "type": "paragraph",
        "children": [
          { "type": "text", "text": "Plain text with " },
          {
            "type": "bold",
            "children": [{ "type": "text", "text": "inline formatting" }]
          }
        ]
      },
      {
        "type": "bullet_list",
        "items": [[{ "type": "text", "text": "Safety" }]]
      }
    ]
  }
}
```

V1 block types are `rich_text`, `heading`, `code`, `callout`, `image`, `table`,
`divider`, and `related_content`. Paragraphs, lists, and inline formatting are
nodes inside `rich_text.props.nodes`; they are not top-level block types. Each
block id is a unique, stable lowercase identifier within the document, from 1
to 128 characters, using lowercase letters, digits, dots, underscores, colons,
or hyphens. The block version is exactly `1`.

The heading anchor is the optional `props.anchor`; the block `id` is never used
as a heading anchor. Anchors are at most 120 lowercase Unicode letters or
digits separated by hyphens. This preserves existing Web-generated fragment
IDs, including Vietnamese headings. Validators reject unknown block types,
versions, and fields. Image sources must be local paths or absolute `https://`
URLs.
Rich-text and related content links may be local paths, fragments, or absolute
`http://` and `https://` URLs. Malformed absolute URLs such as `https:example.com`,
URL credentials, protocol-relative URLs, and executable schemes are rejected.
Text is rendered as text by Web's React renderer; authored HTML is not accepted
by this contract. The canonical fixture includes all eight block types.

V1 limits use UTF-8 byte size for the whole compact JSON document and code
source. Other text and identifiers use string length. The API validator and
Web renderer apply the same limits:

| Field                    |                 Limit |
| ------------------------ | --------------------: |
| Compact JSON document    | 1,048,576 UTF-8 bytes |
| Blocks per document      |                   500 |
| Block id                 |        128 characters |
| Nested inline formatting |             16 levels |
| Code source              |   100,000 UTF-8 bytes |
| Table dimensions         |  20 columns, 100 rows |
| Related content items    |                    20 |
| URL                      |      2,048 characters |
| Table cell               |      2,000 characters |

## Persistence invariants

- PostgreSQL constraints bind revision and publication references to their
  owning content identity.
- The database rejects updates or deletes to revision and publication rows.
- The database rejects changes to a content item's identity fields.
- The current database constraint validates the broader historical slug
  shape, lifecycle values, archive metadata consistency, and creator foreign
  keys. Runtime article writes, public lookups, and public search/catalog
  projections enforce exact canonical route eligibility. Admin responses
  preserve historical slug values while A01.2 remediation is pending. A later
  approved schema phase may tighten persistence after
  the read-only route preflight and remediation decisions. A partial unique
  index prevents active slug collisions while allowing an archived route to be
  reused.
- Item and revision creator attribution is immutable. Creator fields are
  nullable only for rows that predate lifecycle attribution.
- Creating a revision and moving the latest-revision pointer share one
  transaction. The item row lock checks `DRAFT` state and compares
  `baseRevisionId`; stale writes fail with `ContentRevisionConflictError` and
  create no revision.
- Publishing a revision, recording publication history, and moving the
  published-revision pointer and `PUBLISHED` state share one transaction.
- Publication validates a complete V1 document before persistence through the
  content service.
- State transitions lock the content item and compare the previously observed
  status before writing. Archive and restore never delete or rewrite revisions
  or publication rows.

The read-only operator command `npm run content:route-preflight` classifies
every stored article route and reports blockers and suggested-route collisions.
It never rewrites slugs or changes lifecycle, publication history, or the active
catalog snapshot. This phase does not add the final database route constraint
or route-history redirect persistence; those changes require a reviewed
remediation decision first.
