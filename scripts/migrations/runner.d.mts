export type MigrationDirection = 'up' | 'data-up' | 'down' | 'down-all';
export type FeatureMigrationKind = 'schema' | 'data';
export type FeatureMigrationDescriptor = {
  name: string;
  kind: FeatureMigrationKind;
  timestamp: string;
};

export function migrate(
  direction: MigrationDirection,
  databaseUrl?: string,
): Promise<void>;

export function preflightMigration(
  databaseUrl?: string,
  direction?: MigrationDirection,
): Promise<unknown>;

export function discoverFeatureMigrations(): Promise<
  FeatureMigrationDescriptor[]
>;

export function getFeatureMigrationsInRollbackOrder(
  migrations: readonly FeatureMigrationDescriptor[],
  appliedNames: ReadonlySet<string>,
): FeatureMigrationDescriptor[];

export function countLegacyMigrationFiles(): Promise<number>;
