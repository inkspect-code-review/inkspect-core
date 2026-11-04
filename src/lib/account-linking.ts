import type { BetterAuthOptions } from "better-auth";
import { APIError, addOAuthServerContext, createAuthMiddleware, getAuthoritativeSessionFromCtx, getOAuthState } from "better-auth/api";
import { isLoginProvider } from "./login-providers";

export const LINK_CONFIRMATION_MAX_AGE_MS = 10 * 60 * 1000;

function isRecent(createdAt: Date | string) {
  const age = Date.now() - new Date(createdAt).getTime();
  return age >= 0 && age < LINK_CONFIRMATION_MAX_AGE_MS;
}

export const prepareAccountLink = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== "/link-social") return;
  // Only the browser redirect flow is supported. It binds consent to a
  // single-use OAuth state, the current session and the selected provider.
  if (!isLoginProvider(ctx.body?.provider) || ctx.body?.idToken) {
    throw new APIError("BAD_REQUEST", { code: "LINK_FLOW_REQUIRED", message: "Use the account confirmation page." });
  }
  const session = await getAuthoritativeSessionFromCtx(ctx);
  if (!session || !isRecent(session.session.createdAt)) {
    throw new APIError("UNAUTHORIZED", { code: "LINK_REAUTH_REQUIRED", message: "Sign in again before connecting an account." });
  }
  await addOAuthServerContext({ accountLink: {
    provider: ctx.body.provider,
    userId: session.user.id,
    sessionId: session.session.id,
    confirmedAt: Date.now(),
  } });
});

export const validateAccountLinking: NonNullable<NonNullable<BetterAuthOptions["user"]>["validateUserInfo"]> = async ({ user, source }, ctx) => {
  if (source.action !== "link-account" || source.method !== "oauth") return;
  const provider = source.oauth?.providerId;
  if (!provider) return { error: "account_not_linked" };
  const state = await getOAuthState();
  if (!state?.link) {
    // No provider is globally trusted to bypass email ownership checks.
    // Better Auth separately requires the existing local email to be verified.
    if (user.emailVerified !== true) return { error: "account_not_linked" };
    return;
  }
  const confirmation = state.serverContext?.accountLink;
  if (!confirmation || typeof confirmation !== "object") return { error: "link_reauth_required" };
  const consent = confirmation as Record<string, unknown>;
  const session = await getAuthoritativeSessionFromCtx(ctx);
  if (!isLoginProvider(provider) || ctx.params?.id !== provider ||
    (ctx.path !== `/callback/${provider}` && ctx.path !== "/callback/:id") || !session ||
    consent.provider !== provider || consent.userId !== session.user.id ||
    consent.sessionId !== session.session.id || state.link.userId !== session.user.id ||
    typeof consent.confirmedAt !== "number" || !isRecent(new Date(consent.confirmedAt)) ||
    state.expiresAt <= Date.now() || !isRecent(session.session.createdAt)) {
    return { error: "link_reauth_required" };
  }
  if (typeof user.email !== "string" || user.email.toLowerCase() !== session.user.email.toLowerCase() ||
    state.link.email.toLowerCase() !== session.user.email.toLowerCase()) {
    return { error: "email_does_not_match" };
  }
  // This is the callback's request-local context, after Better Auth validated
  // and consumed state and exchanged the provider code. Never mutate the shared
  // trustedProviders array or promote the provider email to verified.
  ctx.context.trustedProviders = [provider];
};
