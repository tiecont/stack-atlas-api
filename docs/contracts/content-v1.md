# Content document contract v1

This contract is owned by the API for persisted content. During the current
product phase, Web Git content remains canonical. The API content tables are
not populated from Git, and Web does not read them. Web maintains an independent
mirror of these semantics and must not import source files from the API
repository.

Both repositories contain the same canonical JSON fixture:

- API: `test/fixtures/content-document.v1.json`
- Web: `tests/fixtures/content-document.v1.json`

## Identity and lifecycle

- `content_key` is a stable, unique, lowercase key such as
  `article:transactional-outbox`.
- V1 persists article content only. Other content kinds need an explicit schema
  before they are added.
- Revisions are append-only and numbered per content identity.
- Appending a revision requires the caller's expected latest revision id. The
  repository locks the content identity and compares that id before writing.
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

Validators reject unknown block types, versions, and fields. V1 properties and
collections have bounded lengths, and API validation and Web rendering use the
same required and optional fields and bounds. Text is rendered as text by
Web's React renderer; authored HTML is not accepted by this contract. The
canonical fixture includes all eight block types.

## Persistence invariants

- PostgreSQL constraints bind revision and publication references to their
  owning content identity.
- The database rejects updates or deletes to revision and publication rows.
- The database rejects changes to a content item's identity fields.
- Creating a revision and moving the latest-revision pointer share one
  transaction. The expected latest revision is checked while holding a row lock.
- Publishing a revision, recording publication history, and moving the
  published-revision pointer share one transaction.
- Publication validates a complete V1 document before persistence through the
  content service.

There is no public or administrative HTTP endpoint in this foundation. The
service and repository are the persistence boundary for the authoring phase.
