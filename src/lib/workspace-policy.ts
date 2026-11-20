import type { DBAdapter } from "better-auth";
import type { Auth, Repository } from "./github";

/** Optional application policy; the default edition retains its existing behavior. */
export type WorkspacePolicy = {
  assertAccess(organization: string): Promise<void>;
  beforeSaveConnection?(adapter: Pick<DBAdapter, "findOne" | "update">, organization: string, connection: { installationId: string; repositories: Repository[] }, user: string): Promise<void>;
};
const policies = new WeakMap<object, WorkspacePolicy>();
export function registerWorkspacePolicy(auth: Auth, policy: WorkspacePolicy) { policies.set(auth, policy); }
export function workspacePolicy(auth: Auth) { return policies.get(auth); }
