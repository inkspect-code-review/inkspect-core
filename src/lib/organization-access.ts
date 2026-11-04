import type { Auth } from "./github";
import { ReviewError } from "./review-access";
import { requiresAccountOnboarding } from "./account-onboarding-config";
import { ageConfirmationRequired } from "./account-onboarding";

// Shared workspace authorization. Commercial entitlements are checked separately.
export async function organizationAccess(request: Request, auth: Auth) {
  if (request.method !== "GET" && request.headers.get("origin") !== new URL(auth.options.baseURL).origin) throw new ReviewError(403, "This request is not allowed.");
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new ReviewError(401, "Sign in to access this workspace.");
  if (requiresAccountOnboarding(session.user)) throw new ReviewError(403, ageConfirmationRequired);
  const organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!organizationId || session.session.activeOrganizationId !== organizationId) throw new ReviewError(409, "Your workspace changed. Refresh and try again.");
  const { adapter } = await auth.$context;
  const member = await adapter.findOne<{ role: string }>({ model: "member", where: [{ field: "userId", value: session.user.id }, { field: "organizationId", value: organizationId }] });
  if (!member) throw new ReviewError(403, "You no longer have access to this workspace.");
  return { organizationId, user: session.user, canManage: member.role.split(",").some((r) => ["owner", "admin"].includes(r.trim())), adapter };
}
