import type { EngineClaims } from "./engine-client";
import { ReviewError } from "./review-access";
import { database } from "./engine-database";
import type { Worker } from "./worker-type";

type Claims = EngineClaims | Omit<EngineClaims, 'expires'>;

// Saved Inkspect data belongs to the workspace even after GitHub access ends.
// Membership, ownership and the exact connection/installation still apply.
export async function authorizedStoredWorker(claims: Claims): Promise<Worker> {
  const row = (await database().query<Worker>(`SELECT w.* FROM api_repository_worker w
    JOIN "githubConnection" c ON c.id=w.connection_id AND c."organizationId"=w.organization_id AND c."installationId"=w.installation_id::text
    JOIN "githubRepositoryClaim" r ON r."organizationId"=w.organization_id AND r."repositoryId"=w.repository_id
    JOIN member m ON m."organizationId"=w.organization_id AND m."userId"=$5
    WHERE w.organization_id=$1 AND w.repository_id=$2 AND w.connection_id=$3 AND w.installation_id=$4
`,
  [claims.tenant, String(claims.repository), claims.connection, claims.installation, claims.subject])).rows[0];
  if (!row) throw new ReviewError(403, 'Repository access is no longer available.');
  return row;
}

// Admission and live GitHub work also require the current integration selection.
export async function authorizedWorker(claims: Claims): Promise<Worker> {
  const worker = await authorizedStoredWorker(claims);
  const selected = (await database().query(`SELECT 1 FROM "githubConnection" c
    WHERE c.id=$1 AND c."organizationId"=$2 AND c."installationId"=$3
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(c.repositories::jsonb) x
      WHERE x->>'id'=$4 AND lower(x->>'fullName')=lower($5))`,
  [worker.connection_id, worker.organization_id, String(worker.installation_id), worker.repository_id, worker.full_name])).rowCount;
  if (!selected || worker.access_error === 'revoked' || worker.access_error === 'access_unavailable') throw new ReviewError(403, 'Repository access is no longer available.');
  return worker;
}
