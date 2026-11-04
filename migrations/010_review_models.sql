CREATE TABLE IF NOT EXISTS review_model_catalog (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL,
  connection_id text NOT NULL,
  installation_id bigint NOT NULL,
  repository_id bigint NOT NULL,
  engine_origin text NOT NULL,
  default_model_id text NOT NULL,
  region text NOT NULL,
  checked_at timestamptz NOT NULL,
  UNIQUE (organization_id, connection_id, installation_id, repository_id, engine_origin)
);
CREATE TABLE IF NOT EXISTS review_model (
  catalog_id uuid NOT NULL REFERENCES review_model_catalog(id) ON DELETE CASCADE,
  model_id text NOT NULL,
  name text NOT NULL,
  provider text NOT NULL,
  routing text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  available boolean NOT NULL,
  reason text NOT NULL DEFAULT '',
  input_nano_usd bigint NOT NULL DEFAULT 0 CHECK (input_nano_usd >= 0),
  output_nano_usd bigint NOT NULL DEFAULT 0 CHECK (output_nano_usd >= 0),
  budget_nano_usd bigint NOT NULL DEFAULT 0 CHECK (budget_nano_usd >= 0),
  PRIMARY KEY (catalog_id, model_id)
);
UPDATE review_model SET enabled=false WHERE lower(provider)='anthropic' OR model_id LIKE '%anthropic.claude%';
