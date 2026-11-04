import type { Auth, Repository } from "./github";
import { engineRequest } from "./engine-client";
import { readReviewJSON, reviewAccess, ReviewError, reviewFailure, reviewJSON } from "./review-access";
import { reviewChannel } from "./realtime";
import { admitIndex, repositoryStars, setRepositoryStar } from "./repository-store";

const defaultStore = { admitIndex, repositoryStars, setRepositoryStar };
export async function handleRepositories(request: Request, auth: Auth, send = engineRequest, store = defaultStore) {
  try {
    const access = await reviewAccess(request, auth);
    const url = new URL(request.url);
    const action = url.searchParams.get("action") || "detail";
    if (request.method === "GET" && action === "stars") return reviewJSON({ stars: await store.repositoryStars(access.organizationId, access.userId), realtime_channel: reviewChannel(access.organizationId) });
    const repository = Number(url.searchParams.get("repository"));
    if (!Number.isSafeInteger(repository) || repository < 1) throw new ReviewError(400, "Choose a repository.");
    const connection = access.connections.find(c => (JSON.parse(c.repositories) as Repository[]).some(r => r.id === repository));
    if (!connection) throw new ReviewError(403, "This repository is not connected to this workspace.");
    if (request.method === "POST" && action === "star") {
      const body = await readReviewJSON(request);
      if (typeof body.starred !== "boolean") throw new ReviewError(400, "Choose a star preference.");
      await store.setRepositoryStar(access.organizationId, access.userId, repository, body.starred);
      return reviewJSON({ starred: body.starred });
    }
    const claims = { tenant: access.organizationId, subject: access.userId, connection: connection.id, installation: Number(connection.installationId), repository };
    // Share the operator-owned repository routing with Ask AI. Never accept URLs from the client.
    const routes = JSON.parse(process.env.INKSPECT_CHAT_ENGINE_ROUTES || "{}");
    if (!routes || typeof routes !== "object" || Array.isArray(routes)) throw new ReviewError(503, "Repository routing is unavailable.");
    const route = routes[`${access.organizationId}:${repository}`];
    if (route !== undefined && typeof route !== "string") throw new ReviewError(503, "Repository routing is unavailable.");
    const env = route ? { ...process.env, INKSPECT_ENGINE_URL: route } : process.env;
    if (request.method === "GET" && action === "detail") return reviewJSON({ ...await send("/repository/index", "GET", undefined, claims, fetch, env), realtime_channel: reviewChannel(access.organizationId) });
    if (request.method === "POST" && (action === "index" || action === "analyze" || action === "cancel")) {
      const body = await readReviewJSON(request);
      if (typeof body.requestId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(body.requestId)) throw new ReviewError(400, "Invalid index request.");
      if (action !== "cancel") await store.admitIndex(access.organizationId, access.userId, String(repository), body.requestId);
      return reviewJSON(await send("/repository/index", "POST", { request_id: body.requestId, ...(action !== "index" ? { action } : {}) }, claims, fetch, env), action === "cancel" ? 200 : 202);
    }
    throw new ReviewError(405, "Method not allowed.");
  } catch (error) { return reviewFailure(error); }
}
