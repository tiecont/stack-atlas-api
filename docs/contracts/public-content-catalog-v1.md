# Public Content Catalog V1

This API contract preserves the supplemental Web catalog while article bodies
move to Content Document V1. The API snapshot is imported from one clean,
recorded Web commit. It does not make the API the canonical authoring source
until the Web catalog runtime has passed parity and cutover verification.

## Source snapshot

The importer records:

- source repository `tiecont/stack-atlas`;
- exact 40-character Web commit SHA;
- SHA-256 inventory for discovered source files;
- a canonical checksum for the validated catalog snapshot.

Each snapshot is immutable. A single active pointer selects the snapshot served
to public readers. Reimporting the same SHA and checksum is idempotent. A
different checksum for an already stored SHA is a conflict. Import activation
occurs only after all published articles pass preflight and are imported or
verified as already matching.

## Endpoint

```text
GET /api/v1/content/catalog
```

The endpoint is public and returns metadata only; article bodies are available
from the published article endpoint. It has a bounded public cache policy of
60 seconds with 300 seconds of stale-while-revalidate. Before an active
snapshot exists, it returns Problem Details with status `503` and code
`content_catalog_not_ready`. A stored snapshot that fails schema or checksum
validation returns `503` with code `content_catalog_unavailable`.

The response includes:

```text
schema_version = 1
sourceCommitSha
checksumSha256
generatedAt
site
topics[]
categories[]
paths[]
articles[]
redirects[]
```

Catalog metadata is taken from the immutable source snapshot. Each returned
article is joined by `contentKey` to the current active, published, non-archived
API item and includes its API content id, slug, title, description, published
revision id, publication time, and canonical URL. Draft, archived, and
unpublished articles are omitted. Path module membership, prerequisites, and
related article references are filtered to returned published article ids.
Article legacy redirects target the current API slug. Path and module redirects
retain their catalog destination.

The response does not contain article HTML, source HTML, Git file paths,
account identifiers, or draft data. `checksumSha256` identifies the imported
metadata snapshot; it does not change when API article publication metadata
changes.

## Snapshot shape

The validated snapshot has exact keys and rejects unknown fields:

```json
{
  "schema_version": 1,
  "site": { "name": "Stack Atlas", "description": "...", "language": "vi" },
  "topics": [],
  "categories": [],
  "paths": [],
  "articles": [],
  "redirects": []
}
```

The compact JSON representation is limited to 2,097,152 UTF-8 bytes. The
validator also bounds topic, category, path, module, article, relationship,
and redirect counts and field lengths.

The snapshot preserves the Web source fields needed to render topic/path
navigation, filter/search metadata, article relationships, and resolve legacy
routes. It is an import artifact, not a generic taxonomy or content-management
API. Normal editing and publication continue through the admin content API.

## Cutover gate

Web keeps filesystem catalog reads until a clean merged Web commit and the
active API snapshot have been compared. The parity report must account for
article, topic, path, and redirect inventories; article order and canonical
URLs; titles, headings, links, path membership and prerequisites; search and
SEO behavior; and every intentional filter of unpublished or archived data.
No unexplained mismatch may remain before filesystem runtime ownership is
removed.
