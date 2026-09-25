exports.up = (pgm) => {
  pgm.createSchema('stack_atlas');
};

exports.down = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_class AS relation
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'stack_atlas'
      ) THEN
        RAISE EXCEPTION 'Refusing to drop the non-empty stack_atlas schema';
      END IF;
    END;
    $$;
  `);
  pgm.dropSchema('stack_atlas');
};
