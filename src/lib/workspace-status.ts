import type { Auth } from "./github";
import { workspacePolicy } from "./workspace-policy";
import { githubConfig, type GitHubConnection, type Repository } from "./github";

export async function workspaceStatus(organizationId: string, userId: string, auth: Auth) {
  await workspacePolicy(auth)?.assertAccess(organizationId);
  const { adapter } = await auth.$context;
  const where = [{ field: "organizationId", value: organizationId }];
  const [member, connections, setup] = await Promise.all([
    adapter.findOne<{ role: string }>({ model: "member", where: [...where, { field: "userId", value: userId }] }),
    adapter.findMany<GitHubConnection>({ model: "githubConnection", where, sortBy: { field: "accountLogin", direction: "asc" }, limit: 10_000 }),
    adapter.findOne<{ dismissedAt: Date | null }>({ model: "workspaceSetup", where }),
  ]);
  if (!member) throw new Error("Workspace membership required.");
  const connected = connections.map((connection) => ({ id: connection.id, installationId: connection.installationId, accountLogin: connection.accountLogin, repositories: JSON.parse(connection.repositories) as Repository[], updatedAt: connection.updatedAt.toISOString() }));
  return {
    configured: !!githubConfig(),
    canManage: member.role.split(",").some((role) => ["owner", "admin"].includes(role.trim())),
    dismissed: !!setup?.dismissedAt,
    connections: connected,
    repositories: [...new Map(connected.flatMap((connection) => connection.repositories).map((repo) => [repo.id, repo])).values()],
  };
}
export type WorkspaceStatus = Awaited<ReturnType<typeof workspaceStatus>>;
