-- B1: a table for the schema version, so the migration path is proven before real tables arrive.
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO meta (key, value) VALUES ('schema_version', '1');
