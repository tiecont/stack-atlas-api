# Content document contract v1

This contract is the API-owned persistence and validation shape for future
article authoring. During the current product phase, Web Git content remains
canonical. The API content tables are not populated from Git, and Web does not
read them.

## Identity and lifecycle

- `content_key` is a stable, unique, lowercase key such as
  `article:transactional-outbox`.
- V1 persists article content only. Other content kinds need an explicit schema
  before they are added.
- Revisions are append-only and numbered per content identity.
- A revision stores a validated document and SHA-256 checksum of canonical JSON.
- Publication history is append-only. The current published revision points to
  one immutable revision belonging to the same content identity.
- Authoring HTTP routes, admin permissions, and Git import/cutover are not part
  of this foundation.

## Document

```json
{
  "schema_version": 1,
  "title": "Transactional outbox",
  "description": "Persist business state and an event in one transaction.",
  "blocks": [
    { "type": "paragraph", "text": "A plain text paragraph." },
    { "type": "heading", "level": 2, "id": "trade-offs", "text": "Trade-offs" },
    { "type": "code", "language": "sql", "code": "COMMIT;" },
    { "type": "list", "ordered": false, "items": ["Safety", "Liveness"] },
    {
      "type": "callout",
      "tone": "info",
      "title": "Note",
      "text": "A useful detail."
    },
    {
      "type": "quote",
      "text": "Make state explicit.",
      "attribution": "Stack Atlas"
    }
  ]
}
```

V1 supports `paragraph`, `heading`, `code`, `list`, `callout`, and `quote`
blocks. Validators reject unknown block types and unknown fields. Text is
rendered as text by Web's React renderer; authored HTML is not accepted by this
contract.

## Persistence invariants

- PostgreSQL constraints bind revision and publication references to their
  owning content identity.
- The database rejects updates or deletes to revision and publication rows.
- The database rejects changes to a content item's identity fields.
- Creating a revision and moving the latest-revision pointer share one
  transaction.
- Publishing a revision, recording publication history, and moving the
  published-revision pointer share one transaction.
- Publication validates a complete V1 document before persistence through the
  content service.

There is no public or administrative HTTP endpoint in this foundation. The
service and repository are the persistence boundary for the authoring phase.
