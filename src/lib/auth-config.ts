import type { BetterAuthOptions } from "better-auth";

type Environment = Record<string, string | undefined>;

export class AuthConfigurationError extends Error {}

export function readAuthEnvironment(env: Environment = process.env) {
  const secret = env.BETTER_AUTH_SECRET?.trim();
  const baseURL = env.BETTER_AUTH_URL?.trim();
  const databaseURL = env.DATABASE_URL?.trim();
  if (!secret || secret.length < 32 || !baseURL || !databaseURL) {
    throw new AuthConfigurationError("Set BETTER_AUTH_URL, BETTER_AUTH_SECRET (32+ characters), and DATABASE_URL.");
  }
  const url = new URL(baseURL);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      (url.protocol !== "https:" && !(local && url.protocol === "http:" && env.NODE_ENV !== "production"))) {
    throw new AuthConfigurationError("BETTER_AUTH_URL must be an HTTPS origin (HTTP localhost is allowed in development).");
  }
  if (!["postgres:", "postgresql:"].includes(new URL(databaseURL).protocol)) {
    throw new AuthConfigurationError("DATABASE_URL must point to PostgreSQL.");
  }
  return { secret, baseURL: url.origin, databaseURL };
}

export function socialProviders(env: Environment = process.env): BetterAuthOptions["socialProviders"] {
  const credentials = (prefix: string) => {
    const clientId = env[`${prefix}_CLIENT_ID`]?.trim();
    const clientSecret = env[`${prefix}_CLIENT_SECRET`]?.trim();
    return clientId && clientSecret ? { clientId, clientSecret } : undefined;
  };
  const github = credentials("GITHUB");
  const google = credentials("GOOGLE");
  const microsoft = credentials("MICROSOFT");
  const apple = credentials("APPLE");
  return {
    ...(github && { github }),
    ...(google && { google: { ...google, prompt: "select_account" } }),
    ...(microsoft && { microsoft: {
      ...microsoft,
      tenantId: env.MICROSOFT_TENANT_ID?.trim() || "common",
      prompt: "select_account",
      mapProfileToUser: () => ({ image: undefined }),
    } }),
    ...(apple && { apple }),
  };
}
