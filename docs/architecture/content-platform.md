# Content platform foundation

The API owns the future content persistence boundary under
`modules/content/catalog`: stable article identity, immutable numbered
revisions, validated document payloads, and append-only publication history.
The service validates before creating a revision and again before publishing;
the repository uses PostgreSQL transactions to append a revision and move the
latest pointer, or record publication and move the published pointer.

During this phase, Web Git remains the canonical authored source. The API does
not import existing Git content, expose content read/authoring HTTP routes, or
serve learner pages. Web keeps reading its local validated catalog. There is
no dual-write. API admin authoring and publishing routes, followed by Web
editor integration and an explicit cutover, belong to later phases.

V1 is limited to article content. A future content kind needs its own validated
document contract. The API contract is defined in
[`../contracts/content-v1.md`](../contracts/content-v1.md); Web mirrors its
block types in its own repository and remains buildable without an API checkout.

The API feature has no controller or authorization provider yet. Future admin
routes must enforce server-side permissions before invoking the service. This
foundation establishes persistence semantics only; it does not create an
accidental public CMS.
