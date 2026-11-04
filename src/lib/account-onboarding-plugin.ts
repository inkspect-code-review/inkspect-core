import { requiresAccountOnboarding } from "./account-onboarding-config";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, getAuthoritativeSessionFromCtx } from "better-auth/api";
import { ageConfirmationRequired } from "./account-onboarding";

export function accountOnboarding() {
  return {
    id: "account-onboarding",
    schema: { user: { fields: {
      ageConfirmedAt: { type: "date", required: false, input: false },
      ageConfirmationVersion: { type: "string", required: false, input: false },
      referralSource: { type: "string", required: false, input: false },
    } } },
    hooks: { before: [{
      matcher: (ctx) => ctx.path?.startsWith("/organization/") ?? false,
      handler: createAuthMiddleware(async (ctx) => {
        const session = await getAuthoritativeSessionFromCtx(ctx);
        if (session && requiresAccountOnboarding(session.user)) {
          throw new APIError("FORBIDDEN", { code: "AGE_CONFIRMATION_REQUIRED", message: ageConfirmationRequired });
        }
      }),
    }] },
  } satisfies BetterAuthPlugin;
}
