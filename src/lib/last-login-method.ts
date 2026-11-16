import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { lastLoginMethodCookie, loginMethodForPath, parseLoginMethod } from "./login-providers";

export const pendingLoginMethodCookie = "pending-login-method";

// Run after the two-factor hook: a challenge is not a completed sign-in.
export function rememberLastLoginMethod() {
  return {
    id: "remember-last-login-method",
    hooks: { after: [{
      matcher: ctx => !!loginMethodForPath(ctx.path, ctx.params?.id) || ctx.path?.startsWith("/two-factor/verify-") === true,
      handler: createAuthMiddleware(async ctx => {
        const session = ctx.context.newSession;
        if (!session) return;
        let method = loginMethodForPath(ctx.path, ctx.params?.id);
        const pending = ctx.context.createAuthCookie(pendingLoginMethodCookie, { maxAge: 600 });
        if (!method) {
          const saved = await ctx.getSignedCookie(pending.name, ctx.context.secret);
          if (saved) {
            const separator = saved.indexOf(":");
            if (saved.slice(separator + 1) === session.user.id) method = parseLoginMethod(saved.slice(0, separator));
          }
        }
        if (!method) return;
        ctx.setCookie(lastLoginMethodCookie, method, {
          ...ctx.context.authCookies.sessionToken.attributes,
          httpOnly: true,
          maxAge: 60 * 60 * 24 * 180,
        });
        ctx.setCookie(pending.name, "", { ...pending.attributes, maxAge: 0 });
      }),
    }] },
  } satisfies BetterAuthPlugin;
}
