# Content platform foundation

The API owns the content persistence boundary under `modules/content/catalog`:
stable article identity and route slug, explicit lifecycle state, immutable
numbered revisions, validated document payloads, creator attribution, and
append-only publication history. The service validates input and checks the
authenticated principal's current platform permission before mutations. The
repository uses PostgreSQL transactions and row locks to append a revision and
move the latest pointer, publish and move the published pointer, or archive and
restore an item without deleting its history.

Web Git remains the canonical source for supplemental catalog metadata until
the catalog cutover is approved and verified. An explicit operator CLI imports
published articles and a validated metadata snapshot from a clean Web checkout
pinned to an exact commit SHA. The snapshot preserves site, topic, category,
path, module, relationship, and legacy redirect metadata. It is immutable and
records its source SHA and checksum. Article items are written through the
catalog service; the snapshot becomes active only after article preflight and
imports succeed. The operation does not switch filesystem runtime reads or
delete Git content. See
[`../contracts/public-content-catalog-v1.md`](../contracts/public-content-catalog-v1.md).

`GET /api/v1/content/catalog` serves the active snapshot joined to current
published article identities and publication metadata. It excludes drafts and
archived articles, filters unresolved/unpublished article references, and
returns `503` until an operator activates a snapshot. The route is a migration
contract; Web must keep filesystem catalog reads until source-SHA parity and
runtime behavior are verified. Published article reads and search continue to
return only published content.

V1 is limited to article content. A future content kind needs its own validated
document contract. The API contract is defined in
[`../contracts/content-v1.md`](../contracts/content-v1.md); Web mirrors its
block types and validation rules independently in its own repository and
remains buildable without an API checkout. Each repository keeps a copied
canonical JSON fixture and tests its own validator/renderer against that copy.
The API fixture is `test/fixtures/content/content-document-v1.json`; no source
or fixture is loaded from the Web checkout.

Revision append requires `baseRevisionId`. Under the item row lock, the
repository checks that the item is in `DRAFT` and compares the base with
`latest_revision_id`; stale editors conflict before a new revision is inserted.
The contract bounds the compact document to 1 MiB and code source to 100,000
UTF-8 bytes, validates URL schemes, and keeps block ids unique within each
document.

The lifecycle starts in `DRAFT`. Editors can submit a draft for review, return
an in-review item to draft, or reopen a published item as draft. Publishing is
allowed only from `IN_REVIEW`; archive is allowed from any non-archived state,
and restore returns an item to `DRAFT`. `ARCHIVED` items are omitted from
published lookup while their revisions and publication history remain intact.

Slugs are normalized, bounded URL paths with non-empty segments and protected
reserved route roots. PostgreSQL enforces active-slug uniqueness; archiving
releases a route, and restore detects if that route has since been reused.
Legacy items receive stable `legacy-<uuid>` slugs; an existing published pointer
keeps its item in `PUBLISHED`, while other legacy items begin in `DRAFT`.
Historical creator fields remain nullable, while new item, revision, and archive
writes use the account from `AuthenticatedPrincipal` and persist actor
attribution.

Admin routes run `SessionAuthGuard` before `PermissionGuard`, require the
operation's typed platform permission, and pass the authenticated principal to
the catalog service. `POST /api/v1/admin/content/:id/submit-for-review` makes
the existing review transition available; publication remains restricted to
`IN_REVIEW`. Public slug lookup returns only an active `PUBLISHED` item and
never falls back to its latest draft. Public search matches those published
documents and returns bounded summaries without document bodies. Content reads
return structured Content Document V1 data; rendering HTML remains a Web
responsibility.
