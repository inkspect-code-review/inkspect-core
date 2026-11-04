import { applicationPool } from "./application-database";
import { ReviewError } from "./review-access";
import { bedrockConfig } from "./bedrock";

// Indexing is included for every connected workspace. It neither requires a
// paid plan/seat/balance and does not consume AI Credits.
export async function indexAccessGate(organization: string, user: string, repository: string) {
  await verifyIndexAccess(organization, user, repository);
  const config = bedrockConfig();
  return { allowed: true, model: config.model, region: config.region, input_rate: config.inputRate?.toString(), output_rate: config.outputRate?.toString() };
}
export async function admitIndex(organization: string, user: string, repository: string, id: string) {
  await indexAccessGate(organization, user, repository);
  await applicationPool().query("INSERT INTO repository_index_operation(id,organization_id,user_id,repository_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [id, organization, user, repository]);
  return indexOperation(organization, user, id, repository);
}
export async function indexOperation(organization: string, user: string, id: string, repository?: string) {
  const row = (await applicationPool().query<{ user_id: string; repository_id: string }>("SELECT user_id,repository_id FROM repository_index_operation WHERE organization_id=$1 AND id=$2", [organization, id])).rows[0];
  if (!row || row.user_id !== user || (repository !== undefined && row.repository_id !== repository)) throw new ReviewError(403, "Index operation scope mismatch.");
  return row;
}
export async function repositoryStars(organization: string, user: string) {
  return (await applicationPool().query<{ repository_id: string }>("SELECT repository_id FROM repository_star WHERE organization_id=$1 AND user_id=$2", [organization, user])).rows.map(row => Number(row.repository_id));
}
export async function setRepositoryStar(organization: string, user: string, repository: number, starred: boolean) {
  if (starred) await applicationPool().query("INSERT INTO repository_star(organization_id,user_id,repository_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [organization, user, String(repository)]);
  else await applicationPool().query("DELETE FROM repository_star WHERE organization_id=$1 AND user_id=$2 AND repository_id=$3", [organization, user, String(repository)]);
}

export async function verifyIndexAccess(organization: string, user: string, repository: string) {
  const access = (await applicationPool().query(`SELECT 1 FROM member m JOIN "githubRepositoryClaim" r ON r."organizationId"=m."organizationId" WHERE m."organizationId"=$1 AND m."userId"=$2 AND r."repositoryId"=$3`, [organization, user, repository])).rowCount;
  if (!access) throw new ReviewError(403, "Repository access was revoked.");
  return { allowed: true };
}
