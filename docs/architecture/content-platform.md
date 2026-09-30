# Content platform foundation

The API owns the content persistence boundary under `modules/content/catalog`:
stable article identity and route slug, explicit lifecycle state, immutable
numbered revisions, validated document payloads, creator attribution, and
append-only publication history. The service validates input and checks the
authenticated principal's current platform permission before mutations. The
repository uses PostgreSQL transactions and row locks to append a revision and
move the latest pointer, publish and move the published pointer, or archive and
restore an item without deleting its history.

During this phase, Web Git remains the canonical authored source. The API does
not import existing Git content, expose content read/authoring HTTP routes, or
serve learner pages. Web keeps reading its local validated catalog. There is
no dual-write. Web editor integration and an explicit cutover belong to later
phases. No full admin HTTP CRUD surface is exposed by the lifecycle service.

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

Future admin routes must run `SessionAuthGuard` and `PermissionGuard` before
their controller and then pass the authenticated principal to the lifecycle
service. This phase establishes authoring lifecycle semantics without creating
an accidental public CMS.
