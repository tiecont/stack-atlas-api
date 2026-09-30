# Content document contract v1

This contract is owned by the API for persisted content. During the current
product phase, Web Git content remains canonical. The API content tables are
not populated from Git, and Web does not read them. Web maintains an independent
mirror of these semantics and must not import source files from the API
repository.

Both repositories keep independent copies of the same canonical JSON fixture:

- API: `test/fixtures/content/content-document-v1.json`
- Web: `tests/fixtures/content-document.v1.json`

## Identity and lifecycle

- `content_key` is a stable, unique, lowercase key such as
  `article:transactional-outbox`.
- V1 persists article content only. Other content kinds need an explicit schema
  before they are added.
- Revisions are append-only and numbered per content identity.
- Appending a revision requires the caller's `baseRevisionId`. The repository
  locks the content identity and compares it with `latest_revision_id` before
  writing.
  Stale and competing writes fail with `ContentRevisionConflictError` without
  creating a revision.
- A revision stores a validated document and SHA-256 checksum of canonical JSON.
- Publication history is append-only. The current published revision points to
  one immutable revision belonging to the same content identity.
- Authoring HTTP routes, admin permissions, and Git import/cutover are not part
  of this foundation.

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
as a heading anchor. Validators reject unknown block types, versions, and
fields. Image sources must be local paths or HTTPS URLs. Rich-text and related
content links may be local paths, fragments, or HTTP(S) URLs. URL credentials,
protocol-relative URLs, and executable schemes are rejected. Text is rendered
as text by Web's React renderer; authored HTML is not accepted by this contract.
The canonical fixture includes all eight block types.

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
- Creating a revision and moving the latest-revision pointer share one
  transaction. `baseRevisionId` is compared while holding a row lock; stale
  writes fail with `ContentRevisionConflictError` and create no revision.
- Publishing a revision, recording publication history, and moving the
  published-revision pointer share one transaction.
- Publication validates a complete V1 document before persistence through the
  content service.

There is no public or administrative HTTP endpoint in this foundation. The
service and repository are the persistence boundary for the authoring phase.
