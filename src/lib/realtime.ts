import { createHash } from "node:crypto";
import { PubbServer } from "@pubb/sdk/server";
import type { Auth } from "./github";
import { readReviewJSON, reviewAccess, ReviewError, reviewFailure, reviewJSON } from "./review-access";

export const reviewChannel = (organizationId: string) => `private-reviews-${createHash("sha256").update(organizationId).digest("hex")}`;
export function realtimeServer(env = process.env) {
  if (!env.PUBB_APP_SECRET || !env.PUBB_APP_ID || !env.NEXT_PUBLIC_PUBB_APP_KEY) throw new ReviewError(503, "Live updates are not configured yet.");
  return new PubbServer({ appId: env.PUBB_APP_ID, key: env.NEXT_PUBLIC_PUBB_APP_KEY, secret: env.PUBB_APP_SECRET, apiHost: "https://api.pubb.io" });
}
export async function authorizeRealtime(request: Request, auth: Auth, server = realtimeServer) {
  try {
    const access = await reviewAccess(request, auth);
    const body = await readReviewJSON(request);
    if (body.channel_name !== reviewChannel(access.organizationId) || typeof body.socket_id !== "string" || !/^[a-zA-Z0-9._-]{1,100}$/.test(body.socket_id)) throw new ReviewError(403, "This subscription is not allowed.");
    return reviewJSON(server().authenticatePrivateChannel(body.socket_id, body.channel_name));
  } catch (error) { return reviewFailure(error); }
}
// Fixed public diagnostic only. No caller-supplied message/channel or repo data.
export async function publishRealtimeTest(request: Request, auth: Auth, fetcher = fetch, env = process.env) {
  try {
    const { member } = await reviewAccess(request, auth);
    if (!member.role.split(",").some((role) => ["owner", "admin"].includes(role.trim()))) throw new ReviewError(403, "Only workspace admins can test the connection.");
    return reviewJSON(await publishConnectionTest(fetcher, env), 202);
  } catch (error) { return reviewFailure(error); }
}

// Trusted local server diagnostic, also used by the authorized admin route.
export async function publishConnectionTest(fetcher = fetch, env = process.env) {
    if (!env.PUBB_APP_SECRET || !env.PUBB_APP_ID) throw new ReviewError(503, "Live updates are not configured yet.");
    const response = await fetcher(`https://api.pubb.io/api/apps/${encodeURIComponent(env.PUBB_APP_ID)}/events`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000), headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.PUBB_APP_SECRET}` }, body: JSON.stringify({ channel: "notifications", name: "message.sent", data: { message: "Hello from Inkspect!" } }) });
    if (response.status !== 202) throw new ReviewError(502, "Pubb did not accept the test event.");
    const receipt = await response.json();
    if (!receipt.accepted || typeof receipt.publicationId !== "string") throw new ReviewError(502, "Invalid publish receipt.");
    return { accepted: true, publicationId: receipt.publicationId };
}
