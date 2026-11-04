import { database } from "./engine-database";

export type StoredReviewRepository = { repositoryId: string; fullName: string; connectionId: string; installationId: string };

// Match stored-data authorization independently of the current GitHub selection.
// Keep the original workspace, member, connection and installation boundaries.
export async function storedReviewRepositories(organizationId: string, userId: string, pool = database()): Promise<StoredReviewRepository[]> {
  return (await pool.query<StoredReviewRepository>(`SELECT w.repository_id AS "repositoryId",w.full_name AS "fullName",
      w.connection_id AS "connectionId",w.installation_id::text AS "installationId"
    FROM api_repository_worker w
    JOIN "githubConnection" c ON c.id=w.connection_id AND c."organizationId"=w.organization_id AND c."installationId"=w.installation_id::text
    JOIN "githubRepositoryClaim" r ON r."organizationId"=w.organization_id AND r."repositoryId"=w.repository_id
    JOIN member m ON m."organizationId"=w.organization_id AND m."userId"=$2
    WHERE w.organization_id=$1 ORDER BY w.full_name,w.repository_id`, [organizationId, userId])).rows;
}
