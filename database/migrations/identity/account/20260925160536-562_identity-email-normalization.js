/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.sql(`
    DO $migration$
    DECLARE
      collision_count integer;
    BEGIN
      SELECT count(*)::integer
      INTO collision_count
      FROM (
        SELECT lower(btrim(email))
        FROM stack_atlas.users
        GROUP BY lower(btrim(email))
        HAVING count(*) > 1
      ) AS normalized_collisions;

      IF collision_count > 0 THEN
        RAISE EXCEPTION
          'Cannot normalize stack_atlas.users.email: found % collision group(s) after lower(btrim(email)); resolve these rows before retrying the migration.',
          collision_count;
      END IF;
    END
    $migration$;

    UPDATE stack_atlas.users
    SET email = lower(btrim(email))
    WHERE email <> lower(btrim(email));

    ALTER TABLE stack_atlas.users
      ADD CONSTRAINT users_email_trimmed
      CHECK (email = lower(btrim(email)));
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE stack_atlas.users
      DROP CONSTRAINT users_email_trimmed;
  `);
};
