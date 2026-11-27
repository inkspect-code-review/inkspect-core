import type { Pool } from 'pg';
import { database } from "./engine-database";
import { authorizedStoredWorker } from "./engine-access";
import type { Worker } from "./worker-type";
import type { FindingRow, FindingsQuery, FindingsTarget, RepositoryFindings } from "./findings";
import { readFindingLifecycle } from "./finding-status-store";
import type { FindingLifecycle } from "./finding-status";

// The repository expression is chosen by the calling query, never by the client.
export function findingPageClauses(options: FindingsQuery, parameter: (value: unknown) => string, repositoryColumn: '$2::bigint' | 'repository_id::bigint') {
  const filters: string[] = [];
  if (options.query) {
    const search = parameter(options.query);
    // Literal substring matching: '%' and '_' are file-name characters, not wildcards.
    filters.push(`(strpos(lower(title), lower(${search})) > 0 OR strpos(lower(path), lower(${search})) > 0)`);
  }
  if (options.severity !== 'all') filters.push(`severity = ${parameter(options.severity)}`);
  if (options.status !== 'all') filters.push(`resolution->>'status' = ${parameter(options.status)}`);
  const cursor = options.cursor;
  const ranks: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
  // The same key order drives SQL pagination, page ordering and the workspace merge.
  const keys = [
    ...(options.sort === 'severity' ? [{ column: 'severity_rank', direction: options.direction, value: cursor ? ranks[cursor.severity] : null, cast: '::int' }] : []),
    { column: 'created_at', direction: options.sort === 'date' ? options.direction : 'desc', value: cursor?.createdAt, cast: '::timestamptz' },
    { column: 'job_id COLLATE "C"', direction: 'desc', value: cursor?.jobId, cast: '::text COLLATE "C"' },
    { column: 'ordinal', direction: 'asc', value: cursor?.ordinal, cast: '::bigint' },
    { column: repositoryColumn, direction: 'desc', value: cursor?.repositoryId, cast: '::bigint' },
  ];
  const orderBy = keys.map(key => `${key.column} ${key.direction === 'asc' ? 'ASC' : 'DESC'}`).join(',');
  const bounds = cursor ? keys.map(key => `${parameter(key.value)}${key.cast}`) : [];
  const after = cursor ? `WHERE ${keys.map((key, index) => `(${[
    ...keys.slice(0, index).map((prior, before) => `${prior.column} = ${bounds[before]}`),
    `${key.column} ${key.direction === 'asc' ? '>' : '<'} ${bounds[index]}`,
  ].join(' AND ')})`).join(' OR ')}` : '';
  return { filters, after, orderBy };
}

// Each source returns one page plus a lookahead. Reports and history are never
// downloaded in full just to filter or paginate their findings.
export async function queryFindingSource(pool: Pool, worker: Worker, options: FindingsQuery, legacy = false, excludedIds: string[] = [], lifecycle?: FindingLifecycle) {
  if (legacy && !/^[a-z][a-z0-9_]{0,62}$/.test(worker.queue_schema)) throw new Error('Invalid queue schema');
  const schema = legacy ? `"${worker.queue_schema}"` : '';
  const values: unknown[] = [worker.organization_id, worker.repository_id, worker.connection_id, String(worker.installation_id)];
  const parameter = (value: unknown) => { values.push(value); return `$${values.length}`; };
  const where = ["status='completed'", "NOT (request ? 'fix_of')"];
  if (options.from) where.push(`created_at >= ${parameter(options.from)}::timestamptz`);
  if (options.before) where.push(`created_at < ${parameter(options.before)}::timestamptz`);
  if (legacy && excludedIds.length) where.push(`NOT (id = ANY(${parameter(excludedIds)}::text[]))`);
  const statuses = parameter(JSON.stringify(lifecycle?.statuses ?? {}));
  const { filters, after, orderBy } = findingPageClauses(options, parameter, '$2::bigint');
  const source = legacy
    ? `SELECT j.id,j.status,j.created_at,j.request,j.request AS snapshot,r.report
       FROM ${schema}.jobs j LEFT JOIN ${schema}.runs r ON r.tenant_id=j.tenant_id AND r.id=j.id
       WHERE j.tenant_id=$1 AND j.scope->>'repository_id'=$2 AND j.request->>'connection_id'=$3 AND j.request->>'installation_id'=$4`
    : `SELECT id,status,created_at,request,snapshot,report FROM api_engine_job
       WHERE organization_id=$1 AND repository_id=$2 AND connection_id=$3 AND installation_id=$4::bigint`;
  const result = await pool.query(`WITH scoped AS (${source}), reviews AS (
      SELECT *, coalesce(report->'run'->>'id'=id AND report->'run'->'target'->>'tenant_id'=$1
        AND report->'run'->'target'->>'repository_id'=$2 AND jsonb_typeof(report->'findings')='array', false) AS valid
      FROM scoped WHERE ${where.join(' AND ')}
    ), expanded AS (
      SELECT r.id AS job_id,r.created_at,r.snapshot,f.ordinal,
        coalesce(f.value->>'id','') AS id,coalesce(f.value->>'title','') AS title,
        CASE lower(trim(f.value->>'severity')) WHEN 'p0' THEN 'critical' WHEN 'critical' THEN 'critical'
          WHEN 'p1' THEN 'high' WHEN 'high' THEN 'high' WHEN 'p2' THEN 'medium' WHEN 'medium' THEN 'medium' ELSE 'low' END AS severity,
        coalesce(f.value->'location'->>'path','') AS path,
        CASE WHEN f.value->'location'->>'start_line' ~ '^[0-9]{1,9}$' THEN (f.value->'location'->>'start_line')::int ELSE 0 END AS line,
        coalesce(f.value->>'advisory'='true',false) AS advisory,
        coalesce(${statuses}::jsonb->r.id->((f.ordinal-1)::int),'{"status":"historical","source":"earlier_review"}'::jsonb) AS resolution
      FROM reviews r CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN r.valid THEN r.report->'findings' ELSE '[]'::jsonb END) WITH ORDINALITY AS f(value,ordinal)
    ), filtered AS (SELECT *, CASE severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END AS severity_rank
      FROM expanded ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}), page AS (
      SELECT * FROM filtered ${after} ORDER BY ${orderBy} LIMIT 26
    ) SELECT (SELECT count(*) FROM filtered)::int AS total,
      (SELECT count(*) FROM reviews WHERE NOT valid)::int AS unavailable,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'jobId',job_id,'ordinal',ordinal,'title',title,'severity',severity,'path',path,'line',line,'advisory',advisory,'resolution',resolution,
        'createdAt',to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'pullUrl',snapshot->>'url') ORDER BY ${orderBy}) FROM page),'[]'::jsonb) AS findings`, values);
  const resultRow = result.rows[0] as { total: number; unavailable: number; findings: (Omit<FindingRow, 'repositoryId' | 'repository' | 'pullNumber'> & { pullUrl?: string })[] };
  return { total: resultRow.total, unavailableReports: resultRow.unavailable, findings: resultRow.findings.map(({ pullUrl, ...finding }) => ({
    ...finding, repositoryId: Number(worker.repository_id), repository: worker.full_name,
    pullNumber: Number(pullUrl?.match(/\/pull\/(\d+)(?:[/?#]|$)/)?.[1]) || null,
  })) };
}

export async function readRepositoryFindings(target: FindingsTarget, options: FindingsQuery, adjustLifecycle?: (value: FindingLifecycle) => FindingLifecycle): Promise<RepositoryFindings> {
  // Revalidate workspace membership and stored repository ownership on every page.
  const worker = await authorizedStoredWorker(target.claims);
  const stored = await readFindingLifecycle(target, worker);
  const lifecycle = adjustLifecycle ? adjustLifecycle(stored) : stored;
  const current = await queryFindingSource(database(), worker, options, false, [], lifecycle);
  const legacyPool = database(worker.queue_database);
  const tables = (await legacyPool.query('SELECT to_regclass($1) AS jobs,to_regclass($2) AS runs', [`${worker.queue_schema}.jobs`, `${worker.queue_schema}.runs`])).rows[0];
  if (!tables.jobs || !tables.runs) return current;
  // A migrated review may exist in both stores; its current record wins.
  const known = (await database().query<{ id: string }>('SELECT id FROM api_engine_job WHERE organization_id=$1 AND repository_id=$2 AND connection_id=$3 AND installation_id=$4', [worker.organization_id, worker.repository_id, worker.connection_id, worker.installation_id])).rows.map(row => row.id);
  const old = await queryFindingSource(legacyPool, worker, options, true, known, lifecycle);
  return { findings: [...current.findings, ...old.findings], total: current.total + old.total, unavailableReports: current.unavailableReports + old.unavailableReports };
}
