import { workspacePolicy } from "./workspace-policy";
import { requiresAccountOnboarding } from "./account-onboarding-config";
import { ageConfirmationRequired } from "./account-onboarding";
import { captureError } from "./diagnostics/server";
import type { Auth, GitHubConnection } from "./github";

export class ReviewError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function reviewAccess(request: Request, auth: Auth, { allowUnconnected = false } = {}) {
  if (request.method !== "GET" && request.headers.get("origin") !== new URL(auth.options.baseURL).origin) throw new ReviewError(403, "This request is not allowed.");
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new ReviewError(401, "Sign in to view reviews.");
  if (requiresAccountOnboarding(session.user)) throw new ReviewError(403, ageConfirmationRequired);
  const organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!organizationId || organizationId !== session.session.activeOrganizationId) throw new ReviewError(409, "Your workspace changed. Refresh and try again.");
  const { adapter } = await auth.$context;
  const member = await adapter.findOne<{ role: string }>({ model: "member", where: [{ field: "userId", value: session.user.id }, { field: "organizationId", value: organizationId }] });
  if (!member) throw new ReviewError(403, "You no longer have access to this workspace.");
  await workspacePolicy(auth)?.assertAccess(organizationId);
  const connections = await adapter.findMany<GitHubConnection>({ model: "githubConnection", where: [{ field: "organizationId", value: organizationId }], limit: 10_000 });
  if (!connections.length && !allowUnconnected) throw new ReviewError(409, "Connect GitHub to review a pull request.");
  return { userId: session.user.id, organizationId, member, connections };
}
export async function readReviewJSON(request: Request, limit = 4096): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new ReviewError(415, "Send a JSON request.");
  const reader = request.body?.getReader();
  if (!reader) throw new ReviewError(400, "A request body is required.");
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new ReviewError(413, "Request is too large."); }
    chunks.push(value);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new ReviewError(400, "Invalid request."); }
}
export const reviewJSON = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
export const reviewFailure = (error: unknown) => {
  captureError("review.failure", error);
  return reviewJSON({ error: error instanceof ReviewError ? error.message : "The review service is unavailable. Please try again." }, error instanceof ReviewError ? error.status : 503);
};
