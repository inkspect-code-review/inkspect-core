import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { saveReviewModels, storedReviewModels } from "../../src/lib/review-models";
import type { ReviewModels } from "../../src/lib/review-types";

test("stored catalog isolates routing identities, preserves disabled models and replaces snapshots atomically", { skip: process.env.RUN_BILLING_POSTGRES_TEST !== "1" }, async () => {
  const schema = `review_models_${randomUUID().replaceAll("-", "")}`;
  const pool = new Pool({ connectionString: process.env.BILLING_TEST_DATABASE_URL || process.env.DATABASE_URL, options: `-c search_path=${schema}`, max: 2 });
  const scope = { tenant: "workspace", connection: "connection", installation: 44, repository: 17 }, origin = "http://127.0.0.1:8081";
  const catalog: ReviewModels = { default_model_id: "amazon.nova-pro-v1:0", region: "eu-west-2", checked_at: "2026-10-26T10:00:00Z", models: [
    { id: "amazon.nova-pro-v1:0", name: "Nova Pro", provider: "Amazon", routing: "Regional", available: true, input_nano_usd: 1130, output_nano_usd: 4520, budget_nano_usd: 5000000000 },
    { id: "global.anthropic.claude-opus-5-5", name: "Claude Opus", provider: "Anthropic", routing: "Global", available: true, budget_nano_usd: 5000000000 },
    { id: "global.openai.gpt-6.1-sol", name: "GPT", provider: "OpenAI", routing: "Global", available: true, budget_nano_usd: 5000000000 },
  ] };
  try {
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(await readFile(new URL(import.meta.resolve("@inkspect/core/migrations/010_review_models.sql")), "utf8"));
    await assert.rejects(storedReviewModels(scope, pool, origin), /not been synchronized/);
    await saveReviewModels(scope, origin, catalog, pool);
    let result = await storedReviewModels(scope, pool, origin);
    assert.equal(result.models.length, 3);
    assert.equal(result.models.find(m => m.provider === "Anthropic")?.available, false);
    assert.equal(result.models.find(m => m.provider === "Anthropic")?.reason, "Disabled");
    assert.equal(result.models.find(m => m.provider === "Amazon")?.input_nano_usd, 1130);
    assert.equal((await pool.query("SELECT enabled FROM review_model WHERE provider='Anthropic'")).rows[0].enabled, false);
    for (const changed of [{ ...scope, tenant: "other" }, { ...scope, connection: "other" }, { ...scope, installation: 55 }, { ...scope, repository: 18 }]) await assert.rejects(storedReviewModels(changed, pool, origin), /not been synchronized/);
    await assert.rejects(storedReviewModels(scope, pool, "http://127.0.0.1:8082"), /not been synchronized/);
    await pool.query("UPDATE review_model SET enabled=false WHERE provider='OpenAI'");
    await saveReviewModels(scope, origin, { ...catalog, checked_at: "2026-10-26T11:00:00Z" }, pool);
    result = await storedReviewModels(scope, pool, origin);
    assert.equal(result.models.find(m => m.provider === "OpenAI")?.available, false);
    assert.equal(result.models.find(m => m.provider === "Anthropic")?.available, false);
    await assert.rejects(saveReviewModels(scope, origin, { ...catalog, models: [{ ...catalog.models[0], input_nano_usd: -1 }] }, pool), /pricing/);
    assert.equal((await storedReviewModels(scope, pool, origin)).models.length, 3);
    await saveReviewModels(scope, origin, { ...catalog, checked_at: "2026-10-26T12:00:00Z", models: catalog.models.slice(0, 1) }, pool);
    assert.equal((await storedReviewModels(scope, pool, origin)).models.length, 1);
    await saveReviewModels(scope, origin, catalog, pool); // An older overlapping sync cannot restore removed models.
    assert.equal((await storedReviewModels(scope, pool, origin)).models.length, 1);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  }
});
