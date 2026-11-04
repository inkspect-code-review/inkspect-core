CREATE TABLE IF NOT EXISTS repository_star (
 organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 repository_id text NOT NULL,
 PRIMARY KEY(organization_id,user_id,repository_id)
);
CREATE TABLE IF NOT EXISTS repository_index_operation (
 id text PRIMARY KEY,
 organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 repository_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
