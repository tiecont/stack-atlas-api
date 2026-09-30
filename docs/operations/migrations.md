# PostgreSQL migration release procedure

Run migrations from the immutable, versioned API image that will be released.
The application container must not apply migrations during startup. Keep the
image reference, target database, migration output, operator, and release time
in the deployment record.

## Release order

1. Confirm the target database and the exact image digest. Confirm a recent
   database backup and the recovery procedure for the target environment.
2. Run `npm run migration:preflight` from the release image against the target.
   Resolve missing or unexpected migration history before applying anything.
3. Apply schema and legacy migrations with `npm run migrate`.
4. For a release with data migrations, first run
   `npm run migration:preflight:data`, then apply them explicitly with
   `npm run migration:data-up`. Do this only after the required schema is in
   place and before any later contract migration or application cutover that
   depends on the backfill.
5. Run `npm run migration:preflight` again and confirm no required schema
   migrations remain. Deploy the application image and check
   `GET /api/v1/health/ready`.

Large or resumable backfills use a feature-owned command under
`scripts/<context>/<feature>/`; record its dry-run/preflight, batch size,
progress, idempotency, partial-failure, and recovery behavior. Do not hide a
backfill in image build, application startup, or ordinary schema migration.

## Failure handling

Feature migrations run one transaction at a time. If a migration fails, stop the
application rollout and inspect the database migration history and logs. Do not
assume earlier migrations in the same release were rolled back. Fix the cause
and use a forward migration for shared or deployed environments. Restore a
backup only under the target environment's incident procedure after assessing
the data written since the backup.

`npm run migration:down` is for controlled disposable development/test
databases. It is not routine production recovery. The release verifier creates
and drops a unique disposable database, so it belongs in CI or an isolated
verification environment with a scoped administrative connection, never
against the production database.
