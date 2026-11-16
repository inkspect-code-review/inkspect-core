import { APIError, getAuthoritativeSessionFromCtx, createAuthMiddleware } from "better-auth/api";
import { twoFactor } from "better-auth/plugins/two-factor";
import { loginMethodForPath } from "./login-providers";
import { pendingLoginMethodCookie } from "./last-login-method";

// Reuse Better Auth's challenge creation, cookie clearing and attempt limits for
// every sign-in method this app offers, including browser redirect callbacks.
export function accountTwoFactor() {
  const plugin = twoFactor({ issuer: "Inkspect", allowPasswordless: true });
  const challenge = plugin.hooks.after[0];
  plugin.hooks.after = [{
    matcher: (ctx) => challenge.matcher(ctx) || ctx.path === "/magic-link/verify" ||
      ctx.path?.startsWith("/callback/") || ctx.path === "/passkey/verify-authentication",
    handler: createAuthMiddleware(async (ctx) => {
      const needsChallenge = ctx.context.newSession?.user.twoFactorEnabled;
      const signingInUserId = ctx.context.newSession?.user.id;
      const destination = ctx.context.responseHeaders?.get("location");
      // Middleware runtime supports returnHeaders; the plugin's public return type
      // only describes its JSON body. Preserve all cookies from the nested call.
      const result = await challenge.handler({ ...ctx, returnHeaders: true }) as unknown as {
        headers?: Headers;
        response?: { twoFactorRedirect: boolean; twoFactorMethods: string[] };
      };
      result.headers?.forEach((value, key) => { if (key.toLowerCase() !== "set-cookie") ctx.setHeader(key, value); });
      for (const cookie of result.headers?.getSetCookie() ?? []) ctx.setHeader("set-cookie", cookie);
      const method = loginMethodForPath(ctx.path, ctx.params?.id);
      if (needsChallenge && !ctx.context.newSession && signingInUserId && method) {
        const pending = ctx.context.createAuthCookie(pendingLoginMethodCookie, { maxAge: 600 });
        await ctx.setSignedCookie(pending.name, `${method}:${signingInUserId}`, ctx.context.secret, pending.attributes);
      }
      if (needsChallenge && !ctx.context.newSession && destination) {
        const url = new URL(destination, ctx.context.baseURL);
        const next = url.origin === new URL(ctx.context.baseURL).origin ? url.pathname + url.search : "/dashboard";
        throw ctx.redirect(`/login/two-factor?next=${encodeURIComponent(next)}`);
      }
      return result.response;
    }),
  }];
  return { ...plugin, hooks: { ...plugin.hooks, before: [{
    matcher: (ctx: { path?: string }) => ["/two-factor/enable", "/two-factor/disable", "/two-factor/generate-backup-codes", "/passkey/generate-register-options", "/passkey/verify-registration", "/passkey/delete-passkey"].includes(ctx.path ?? ""),
    handler: createAuthMiddleware(async ctx => {
      const session = await getAuthoritativeSessionFromCtx(ctx);
      if (!session) throw new APIError("UNAUTHORIZED", { message: "Sign in to manage account security." });
      if (Date.now() - new Date(session.session.createdAt).getTime() > 10 * 60 * 1000) {
        throw new APIError("FORBIDDEN", { code: "SECURITY_REAUTH_REQUIRED", message: "Sign in again before changing your security settings." });
      }
    }),
  }] } };

}
