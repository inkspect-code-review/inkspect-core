-- Preserve existing installations and repository claims while allowing several
-- installations in one workspace. Keep installationId globally unique.
DO $$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT constraint_row.conname
    FROM pg_constraint constraint_row
    JOIN pg_attribute attribute_row ON attribute_row.attrelid = constraint_row.conrelid
      AND attribute_row.attnum = constraint_row.conkey[1]
    WHERE constraint_row.conrelid = '"githubConnection"'::regclass
      AND constraint_row.contype = 'u'
      AND array_length(constraint_row.conkey, 1) = 1
      AND attribute_row.attname = 'organizationId'
  LOOP
    EXECUTE format('ALTER TABLE "githubConnection" DROP CONSTRAINT %I', item.conname);
  END LOOP;

  -- Some adapters create a standalone unique index instead of a constraint.
  FOR item IN
    SELECT index_class.relname AS name
    FROM pg_index index_row
    JOIN pg_class index_class ON index_class.oid = index_row.indexrelid
    JOIN pg_attribute attribute_row ON attribute_row.attrelid = index_row.indrelid
      AND attribute_row.attnum = index_row.indkey[0]
    WHERE index_row.indrelid = '"githubConnection"'::regclass
      AND index_row.indisunique AND NOT index_row.indisprimary
      AND index_row.indnatts = 1 AND attribute_row.attname = 'organizationId'
  LOOP
    EXECUTE format('DROP INDEX %I', item.name);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS "githubConnection_organizationId_idx"
  ON "githubConnection" ("organizationId");
