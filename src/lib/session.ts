import { requiresAccountOnboarding } from "./account-onboarding-config";
import { welcomePath } from "./account-onboarding";
import { captureError } from "./diagnostics/server";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Auth } from "./github";
import { AuthConfigurationError } from "./auth-config";
import { ensureWorkspace } from "./workspace";

export function createSessionHelpers(getAuth: () => Auth) {
const getSession = cache(async () => {
  const requestHeaders = await headers();
  try {
    return await getAuth().api.getSession({ headers: requestHeaders });
  } catch (error) {
    if (error instanceof AuthConfigurationError) { captureError("auth.configuration", error); return null; }
    throw error;
  }
});

async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (requiresAccountOnboarding(session.user)) redirect(welcomePath());
  if (!session.session.activeOrganizationId) {
    const organizationId = await ensureWorkspace((await getAuth().$context).adapter, session.user.id);
    await getAuth().api.setActiveOrganization({ headers: await headers(), body: { organizationId } });
    session.session.activeOrganizationId = organizationId;
  }
  return session;
}

return { getSession, requireSession };
}
