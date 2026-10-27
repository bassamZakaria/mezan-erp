-- Run as the superuser, against the mezan database: by the postgres image once,
-- on an empty data directory, and by deploy.sh on every deploy. Idempotent.
-- mezan_app is the app's login: it creates, alters and drops the per-schema
-- roles but is not a superuser. Its password is set by deploy.sh from
-- MEZAN_DATABASE_URL; until then it cannot log in.
SELECT 'CREATE ROLE mezan_app NOLOGIN' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mezan_app') \gexec
ALTER ROLE mezan_app NOSUPERUSER CREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 20;
-- PG16+ gives the creator of a role only ADMIN on it; CREATE SCHEMA … AUTHORIZATION
-- needs SET and DROP OWNED / DROP SCHEMA need INHERIT.
ALTER ROLE mezan_app SET createrole_self_grant = 'set, inherit';
-- Ownership-only statements the app role cannot run itself.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database()) \gexec
-- WITH GRANT OPTION: the app grants CONNECT to each schema role it creates.
SELECT format('GRANT CONNECT, CREATE ON DATABASE %I TO mezan_app WITH GRANT OPTION', current_database()) \gexec
-- Schema roles the app did not create itself (made by the superuser before
-- mezan_app existed, or as restore placeholders): the boot re-provisions them.
SELECT format('GRANT %I TO mezan_app WITH ADMIN TRUE, INHERIT TRUE, SET TRUE', rolname)
  FROM pg_roles WHERE rolname = 'platform' OR rolname ~ '^t_[a-z0-9_]+$' \gexec
