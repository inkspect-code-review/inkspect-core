import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { applicationPool } from "./application-database";
import { engineOrigin } from "./engine-routing";
import type { EngineClaims } from "./engine-client";
import { ReviewError } from "./review-access";
import type { ReviewModel, ReviewModels } from "./review-types";

export type ModelScope = Pick<EngineClaims, "tenant" | "connection" | "installation" | "repository">;
const claude = (model: Pick<ReviewModel, "id" | "provider">) => model.provider.toLowerCase() === "anthropic" || model.id.includes("anthropic.claude");
const scopeValues = (scope: ModelScope, origin: string) => [scope.tenant, scope.connection, scope.installation, scope.repository, origin];

// Page loads read PostgreSQL only: never fall back to AWS or a repository worker.
export async function storedReviewModels(scope: ModelScope, pool = applicationPool(), origin = engineOrigin(scope.tenant, scope.repository)): Promise<ReviewModels> {
  if (!origin) throw new ReviewError(503, "Review models have not been synchronized yet.");
  const result = await pool.query(`SELECT c.default_model_id,c.region,c.checked_at,
    COALESCE(jsonb_agg(jsonb_build_object('id',m.model_id,'name',m.name,'provider',m.provider,'routing',m.routing,
      'available',m.available AND m.enabled,'reason',CASE WHEN NOT m.enabled THEN 'Disabled' ELSE m.reason END,
      'input_nano_usd',m.input_nano_usd,'output_nano_usd',m.output_nano_usd,'budget_nano_usd',m.budget_nano_usd)
      ORDER BY m.provider,m.name DESC) FILTER (WHERE m.model_id IS NOT NULL),'[]'::jsonb) AS models
    FROM review_model_catalog c LEFT JOIN review_model m ON m.catalog_id=c.id
    WHERE c.organization_id=$1 AND c.connection_id=$2 AND c.installation_id=$3 AND c.repository_id=$4 AND c.engine_origin=$5
    GROUP BY c.id`, scopeValues(scope, origin));
  const row = result.rows[0];
  if (!row) throw new ReviewError(503, "Review models have not been synchronized yet.");
  return { default_model_id: row.default_model_id, region: row.region, checked_at: new Date(row.checked_at).toISOString(),
    models: (row.models as ReviewModel[]).map(model => claude(model) ? { ...model, available: false, reason: "Disabled" } : model) };
}

// Administrative synchronization only; never called by a page or start request.
// A complete snapshot replaces the previous one atomically. Operator-disabled
// models stay disabled across synchronization, even if AWS grants access later.
export async function saveReviewModels(scope: ModelScope, origin: string, catalog: ReviewModels, pool: Pool = applicationPool()) {
  if (!catalog.region || !catalog.default_model_id || !Number.isFinite(Date.parse(catalog.checked_at)) || !Array.isArray(catalog.models) || !catalog.models.length) throw new Error("Invalid model catalog");
  const ids = new Set<string>();
  for (const m of catalog.models) {
    if (!m.id || ids.has(m.id) || !m.name || !m.provider || !m.routing || typeof m.available !== "boolean") throw new Error("Invalid model catalog entry");
    ids.add(m.id);
    for (const n of [m.input_nano_usd, m.output_nano_usd, m.budget_nano_usd]) if (n !== undefined && (!Number.isSafeInteger(n) || n < 0)) throw new Error("Invalid model pricing");
    if (m.available && !m.budget_nano_usd) throw new Error("Missing model budget");
  }
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    const row = (await tx.query(`INSERT INTO review_model_catalog(id,organization_id,connection_id,installation_id,repository_id,engine_origin,default_model_id,region,checked_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT(organization_id,connection_id,installation_id,repository_id,engine_origin)
      DO UPDATE SET default_model_id=excluded.default_model_id,region=excluded.region,checked_at=excluded.checked_at
      WHERE review_model_catalog.checked_at <= excluded.checked_at RETURNING id`, [randomUUID(), ...scopeValues(scope, origin), catalog.default_model_id, catalog.region, catalog.checked_at])).rows[0];
    if (row) {
      for (const m of catalog.models) await tx.query(`INSERT INTO review_model(catalog_id,model_id,name,provider,routing,enabled,available,reason,input_nano_usd,output_nano_usd,budget_nano_usd)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT(catalog_id,model_id) DO UPDATE SET name=excluded.name,provider=excluded.provider,routing=excluded.routing,
          enabled=review_model.enabled AND excluded.enabled,available=excluded.available,reason=excluded.reason,
          input_nano_usd=excluded.input_nano_usd,output_nano_usd=excluded.output_nano_usd,budget_nano_usd=excluded.budget_nano_usd`,
        [row.id, m.id, m.name, m.provider, m.routing, !claude(m), m.available, m.reason || "", m.input_nano_usd || 0, m.output_nano_usd || 0, m.budget_nano_usd || 0]);
      await tx.query("DELETE FROM review_model WHERE catalog_id=$1 AND NOT(model_id=ANY($2::text[]))", [row.id, [...ids]]);
    }
    await tx.query("COMMIT");
  } catch (error) { await tx.query("ROLLBACK"); throw error; }
  finally { tx.release(); }
}
