import type { Pool } from "pg";
import { database } from "./engine-database";
import { authorizedStoredWorker } from "./engine-access";
import { ReviewError } from "./review-access";
import type { FindingsTarget } from "./findings";
import type { Worker } from "./worker-type";
import { buildFindingLifecycle, type FindingLifecycle, type FindingReviewRecord, type ManualFindingResolution } from "./finding-status";

export async function queryFindingReviewRecords(pool: Pool, worker: Worker, legacy = false): Promise<FindingReviewRecord[]> {
  if (legacy && !/^[a-z][a-z0-9_]{0,62}$/.test(worker.queue_schema)) throw new Error("Invalid queue schema");
  const source = legacy
    ? `SELECT j.id,j.status,j.created_at,j.request,j.request AS snapshot,r.report FROM "${worker.queue_schema}".jobs j LEFT JOIN "${worker.queue_schema}".runs r ON r.tenant_id=j.tenant_id AND r.id=j.id WHERE j.tenant_id=$1 AND j.scope->>'repository_id'=$2 AND j.request->>'connection_id'=$3 AND j.request->>'installation_id'=$4`
    : `SELECT id,status,created_at,request,snapshot,report FROM api_engine_job WHERE organization_id=$1 AND repository_id=$2 AND connection_id=$3 AND installation_id=$4::bigint`;
  return (await pool.query<FindingReviewRecord>(`WITH scoped AS (${source}) SELECT id,status,
    to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",coalesce(snapshot->>'url','') AS url,
    coalesce(snapshot->>'head','') AS head,coalesce(snapshot->>'base_tip','') AS base,
    coalesce(report->'run'->>'id'=id AND report->'run'->'target'->>'tenant_id'=$1 AND report->'run'->'target'->>'repository_id'=$2 AND jsonb_typeof(report->'findings')='array',false) AS valid,
    coalesce(report->'run'->'coverage_complete'='true'::jsonb,false) AS "coverageComplete",
    CASE WHEN report->'run'->'exclusions'->>'excluded_files' ~ '^[0-9]{1,8}$' THEN (report->'run'->'exclusions'->>'excluded_files')::int ELSE 0 END AS "excludedFiles",
    EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(report->'verification_gaps')='array' THEN report->'verification_gaps' ELSE '[]'::jsonb END) g WHERE g->>'blocking'='true') AS "blockingGaps",
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',coalesce(f.value->>'id',''),'severity',coalesce(f.value->>'severity','')) ORDER BY f.ordinal) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(report->'findings')='array' THEN report->'findings' ELSE '[]'::jsonb END) WITH ORDINALITY f(value,ordinal)),'[]'::jsonb) AS findings,
    request->>'fix_of' AS "fixOf",snapshot->>'fix_commit' AS "fixCommit",snapshot->'fix_verification' AS verification FROM scoped`,
  [worker.organization_id, worker.repository_id, worker.connection_id, String(worker.installation_id)])).rows;
}

export async function readFindingLifecycle(target: FindingsTarget, knownWorker?: Worker): Promise<FindingLifecycle> {
  const worker = knownWorker ?? await authorizedStoredWorker(target.claims);
  const pool = database(), legacyPool = database(worker.queue_database);
  const current = await queryFindingReviewRecords(pool, worker);
  const tables = (await legacyPool.query("SELECT to_regclass($1) AS jobs,to_regclass($2) AS runs", [`${worker.queue_schema}.jobs`, `${worker.queue_schema}.runs`])).rows[0];
  const old = tables.jobs && tables.runs ? await queryFindingReviewRecords(legacyPool, worker, true) : [];
  const known = new Set(current.map(row => row.id));
  let manual: ManualFindingResolution[] = [];
  try {
    manual = (await pool.query<ManualFindingResolution>(`SELECT job_id AS "jobId",ordinal,finding_id AS "findingId",resolved_at AS "resolvedAt" FROM api_finding_resolution
      WHERE organization_id=$1 AND repository_id=$2 AND connection_id=$3 AND installation_id=$4`, [worker.organization_id, worker.repository_id, worker.connection_id, String(worker.installation_id)])).rows.map(row => ({ ...row, resolvedAt: new Date(row.resolvedAt).toISOString() }));
  } catch (error) {
    // Older API generations can read automatic status during a rolling migration.
    if ((error as { code?: string }).code !== "42P01") throw error;
  }
  return buildFindingLifecycle([...current, ...old.filter(row => !known.has(row.id))], manual);
}

export async function setManualFindingResolution(target: FindingsTarget, input: { jobId: string; ordinal: number; findingId: string; resolved: boolean }) {
  const worker = await authorizedStoredWorker(target.claims);
  const lifecycle = await readFindingLifecycle(target, worker);
  const review = lifecycle.records.find(row => row.id === input.jobId && row.status === "completed" && row.valid && !row.fixOf);
  if (!review || review.findings[input.ordinal - 1]?.id !== input.findingId) throw new ReviewError(404, "Finding not found in this review.");
  const values = [worker.organization_id, worker.repository_id, worker.connection_id, String(worker.installation_id), input.jobId, input.ordinal, input.findingId, target.claims.subject];
  const allowed = `EXISTS(SELECT 1 FROM api_repository_worker w JOIN "githubConnection" c ON c.id=w.connection_id AND c."organizationId"=w.organization_id AND c."installationId"=w.installation_id::text
    JOIN "githubRepositoryClaim" r ON r."organizationId"=w.organization_id AND r."repositoryId"=w.repository_id
    JOIN member m ON m."organizationId"=w.organization_id AND m."userId"=$8 WHERE w.organization_id=$1 AND w.repository_id=$2 AND w.connection_id=$3 AND w.installation_id=$4::bigint)`;
  if (input.resolved) {
    const result = await database().query(`INSERT INTO api_finding_resolution(organization_id,repository_id,connection_id,installation_id,job_id,ordinal,finding_id,resolved_by)
      SELECT $1,$2,$3,$4::bigint,$5,$6::int,$7,$8 WHERE ${allowed}
      ON CONFLICT(organization_id,repository_id,connection_id,installation_id,job_id,ordinal) DO UPDATE SET finding_id=excluded.finding_id,resolved_by=excluded.resolved_by,resolved_at=clock_timestamp() RETURNING ordinal`, values);
    if (!result.rowCount) throw new ReviewError(403, "You no longer have access to this finding.");
  } else {
    const result = await database().query(`WITH permitted AS (SELECT 1 AS ok WHERE ${allowed}), removed AS (
      DELETE FROM api_finding_resolution WHERE organization_id=$1 AND repository_id=$2 AND connection_id=$3 AND installation_id=$4::bigint AND job_id=$5 AND ordinal=$6::int AND finding_id=$7 AND EXISTS(SELECT 1 FROM permitted) RETURNING ordinal)
      SELECT ok FROM permitted`, values);
    if (!result.rowCount) throw new ReviewError(403, "You no longer have access to this finding.");
  }
  return (await readFindingLifecycle(target, worker)).statuses[input.jobId]?.[input.ordinal - 1];
}

export const findingStatusStore = { read: readFindingLifecycle, resolve: setManualFindingResolution };
