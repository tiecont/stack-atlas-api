exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE stack_atlas.users (
      id uuid PRIMARY KEY,
      email text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT users_email_normalized CHECK (email = lower(email))
    );

    CREATE TABLE stack_atlas.sessions (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES stack_atlas.users(id) ON DELETE CASCADE,
      token_hash char(64) NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz,
      CONSTRAINT sessions_token_hash_format CHECK (token_hash ~ '^[a-f0-9]{64}$'),
      CONSTRAINT sessions_expiry_after_creation CHECK (expires_at > created_at)
    );

    CREATE INDEX sessions_active_user_idx
      ON stack_atlas.sessions (user_id, expires_at)
      WHERE revoked_at IS NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE stack_atlas.sessions;
    DROP TABLE stack_atlas.users;
  `);
};
