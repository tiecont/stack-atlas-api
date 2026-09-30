import { describe, expect, it } from 'vitest';
import {
  getFeatureMigrationsInRollbackOrder,
  type FeatureMigrationDescriptor,
} from '../../../scripts/migrations/runner.mjs';

describe('feature migration rollback order', () => {
  it('reverses applied data migrations before schema migrations', () => {
    const migrations: FeatureMigrationDescriptor[] = [
      { name: 'schema/older', kind: 'schema', timestamp: '1000000000000' },
      { name: 'data/newer', kind: 'data', timestamp: '2000000000000' },
      { name: 'schema/newer', kind: 'schema', timestamp: '3000000000000' },
      { name: 'data/older', kind: 'data', timestamp: '0500000000000' },
    ];
    const applied = new Set(migrations.map((migration) => migration.name));

    expect(
      getFeatureMigrationsInRollbackOrder(migrations, applied).map(
        (migration) => migration.name,
      ),
    ).toEqual(['data/newer', 'data/older', 'schema/newer', 'schema/older']);
  });

  it('omits migrations that were not applied', () => {
    const migrations: FeatureMigrationDescriptor[] = [
      { name: 'data/one', kind: 'data', timestamp: '2000000000000' },
      { name: 'schema/one', kind: 'schema', timestamp: '1000000000000' },
    ];

    expect(
      getFeatureMigrationsInRollbackOrder(migrations, new Set(['schema/one'])),
    ).toEqual(
      migrations.filter((migration) => migration.name === 'schema/one'),
    );
  });
});
