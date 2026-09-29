SELECT format(
  'CREATE DATABASE %I OWNER %I',
  current_database() || '_test',
  current_user
);
\gexec
