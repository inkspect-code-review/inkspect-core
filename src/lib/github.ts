import { requiresAccountOnboarding } from "./account-onboarding-config";
import { workspacePolicy } from "./workspace-policy";
import { captureError } from "./diagnostics/server";
import { safePath } from "./diagnostics/sanitize";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { createEditionAuth } from "./auth-factory";

export type Auth = ReturnType<typeof createEditionAuth>;
export type Repository = { id: number; fullName: string; private: boolean };
export type GitHubConnection = { id: string; organizationId: string; installationId: string; accountLogin: string; repositories: string; updatedAt: Date };
type SetupState = { userId: string; organizationId: string; installationId?: string; returnTo?: "integrations" | "reviews" };
export const stateCookie = "inkspect_github_setup";
export const setupStateCookie = (state: string) => `${stateCookie}_${createHash("sha256").update(state).digest("hex").slice(0, 32)}`;

export function githubConfig(env: Record<string, string | undefined> = process.env) {
  const slug = env.GITHUB_APP_SLUG?.trim();
  const appId = env.GITHUB_APP_ID?.trim();
  const separateApp = !!(env.GITHUB_APP_CLIENT_ID?.trim() || env.GITHUB_APP_CLIENT_SECRET?.trim());
  const clientId = (separateApp ? env.GITHUB_APP_CLIENT_ID : env.GITHUB_CLIENT_ID)?.trim();
  const clientSecret = (separateApp ? env.GITHUB_APP_CLIENT_SECRET : env.GITHUB_CLIENT_SECRET)?.trim();
  if (!slug || !/^[a-z0-9-]+$/.test(slug) || !appId || !/^\d+$/.test(appId) || !clientId || !clientSecret) return null;
  return { slug, appId, clientId, clientSecret };
}

export async function workspaceAdmin(auth: Auth, requestHeaders: Headers, organizationId?: string) {
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) throw new Error("unauthorized");
  if (requiresAccountOnboarding(session.user)) throw new Error("age-confirmation-required");
  const id = organizationId ?? session.session.activeOrganizationId;
  if (!id) throw new Error("forbidden");
  const { adapter } = await auth.$context;
  const member = await adapter.findOne<{ role: string }>({ model: "member", where: [
    { field: "userId", value: session.user.id }, { field: "organizationId", value: id },
  ] });
  if (!member?.role.split(",").some((role) => ["owner", "admin"].includes(role.trim()))) throw new Error("forbidden");
  await workspacePolicy(auth)?.assertAccess(id);
  return { userId: session.user.id, organizationId: id };
}

const identifier = (value: string) => `github-setup:${createHash("sha256").update(value).digest("hex")}`;
export async function createSetupState(auth: Auth, data: SetupState) {
  const value = randomBytes(32).toString("hex");
  await (await auth.$context).internalAdapter.createVerificationValue({ identifier: identifier(value), value: JSON.stringify(data), expiresAt: new Date(Date.now() + 15 * 60_000) });
  return value;
}
export async function consumeSetupState(auth: Auth, value: string | null, cookie: string | undefined, headers: Headers) {
  if (!value || !cookie || !/^[a-f0-9]{64}$/.test(value) || cookie.length !== value.length || !timingSafeEqual(Buffer.from(value), Buffer.from(cookie))) throw new Error("invalid-state");
  const stored = await (await auth.$context).internalAdapter.consumeVerificationValue(identifier(value));
  if (!stored) throw new Error("invalid-state");
  const data = JSON.parse(stored.value) as SetupState;
  const access = await workspaceAdmin(auth, headers, data.organizationId);
  if (access.userId !== data.userId) throw new Error("invalid-state");
  return data;
}

export async function verifyInstallation(config: NonNullable<ReturnType<typeof githubConfig>>, code: string, installationId: string, callbackURL: string, fetcher = fetch) {
  const exchanged = await fetcher("https://github.com/login/oauth/access_token", {
    method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: callbackURL }),
    signal: AbortSignal.timeout(15_000), cache: "no-store",
  });
  if (!exchanged.ok) { captureError("github.exchange", new Error("github-unavailable"), { status: exchanged.status, upstreamRequestId: exchanged.headers.get("x-github-request-id") }); throw new Error("github-unavailable"); }
  const token = await exchanged.json() as { access_token?: string; error?: string };
  if (!token.access_token || token.error) {
    const known = ["redirect_uri_mismatch", "incorrect_client_credentials", "bad_verification_code"];
    throw new Error(token.error && known.includes(token.error) ? token.error : "authorization-failed");
  }
  const get = async (path: string) => {
    const response = await fetcher(`https://api.github.com${path}`, {
      headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10" },
      cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) { captureError("github.api", new Error("github-unavailable"), { path: safePath(path), status: response.status, upstreamRequestId: response.headers.get("x-github-request-id") }); throw new Error("github-unavailable"); }
    return response.json();
  };
  // A setup callback's installation_id is untrusted. Verify it with a user
  // access token before storing any association with the workspace.
  let installation: { id: number; app_id: number; account: { login: string }; suspended_at: string | null } | undefined;
  for (let page = 1; page <= 100; page++) {
    const data = await get(`/user/installations?per_page=100&page=${page}`);
    installation = data.installations.find((item: { id: number; app_id: number }) => String(item.id) === installationId && String(item.app_id) === config.appId);
    if (installation || data.installations.length < 100) break;
  }
  if (!installation || installation.suspended_at) throw new Error("installation-not-authorized");
  const repositories: Repository[] = [];
  for (let page = 1; page <= 100; page++) {
    const data = await get(`/user/installations/${installationId}/repositories?per_page=100&page=${page}`);
    for (const repo of data.repositories) {
      // Do not let a collaborator bind repositories they cannot administer.
      if (repo.permissions?.admin) repositories.push({ id: repo.id, fullName: repo.full_name, private: repo.private });
    }
    if (data.repositories.length < 100) return { installationId, accountLogin: installation.account.login, repositories };
  }
  throw new Error("too-many-repositories");
}

export async function saveConnection(auth: Auth, organizationId: string, connection: Awaited<ReturnType<typeof verifyInstallation>>, accountId = organizationId) {
  const { adapter } = await auth.$context;
  await adapter.transaction(async (tx) => {
    await tx.update({ model: "organization", where: [{ field: "id", value: organizationId }], update: { id: organizationId } });
    await workspacePolicy(auth)?.assertAccess(organizationId);
    await workspacePolicy(auth)?.beforeSaveConnection?.(tx, organizationId, connection, accountId);
    const bound = await tx.findOne<GitHubConnection>({ model: "githubConnection", where: [{ field: "installationId", value: connection.installationId }] });
    if (bound && bound.organizationId !== organizationId) throw new Error("installation-already-connected");
    if (!connection.repositories.length && !bound) throw new Error("no-admin-repositories");
    for (const repo of [...connection.repositories].sort((a, b) => a.id - b.id)) {
      const claim = await tx.findOne<{ organizationId: string }>({ model: "githubRepositoryClaim", where: [{ field: "repositoryId", value: String(repo.id) }] });
      if (claim && claim.organizationId !== organizationId) throw new Error("repository-already-connected");
      if (!claim) await tx.create({ model: "githubRepositoryClaim", data: { repositoryId: String(repo.id), organizationId, accountId, createdAt: new Date() } });
    }
    // The verified GitHub response is the current catalog, including removals.
    // Keep repository claims above independent of current access or selection.
    const data = { organizationId, installationId: connection.installationId, accountLogin: connection.accountLogin, repositories: JSON.stringify([...new Map(connection.repositories.map(repo => [repo.id, repo])).values()]), updatedAt: new Date() };
    if (bound) await tx.update({ model: "githubConnection", where: [{ field: "id", value: bound.id }], update: data });
    else await tx.create({ model: "githubConnection", data });
  });
}
