import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ReviewError } from "./review-access";

type Environment = Record<string, string | undefined>;
export function engineRoutes(env: Environment = process.env): Record<string, string> {
  try {
    let local: unknown = {};
    if (env.INKSPECT_ENGINE_ROUTES_FILE || env.NODE_ENV === "development") {
      try { local = JSON.parse(readFileSync(resolve(/*turbopackIgnore: true*/ env.INKSPECT_ENGINE_ROUTES_FILE || ".local/review-engines/routes.json"), "utf8")); }
      catch (error) { if (env.INKSPECT_ENGINE_ROUTES_FILE || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    const configured: unknown[] = [local, JSON.parse(env.INKSPECT_CHAT_ENGINE_ROUTES || "{}"), JSON.parse(env.INKSPECT_ENGINE_ROUTES || "{}")];
    const result: Record<string, string> = {};
    for (const routes of configured) {
      if (!routes || typeof routes !== "object" || Array.isArray(routes)) throw new Error("Invalid routing map");
      for (const [key, value] of Object.entries(routes)) {
        if (!/^[A-Za-z0-9_-]+:[1-9][0-9]*$/.test(key) || typeof value !== "string") throw new Error("Invalid routing entry");
        const url = new URL(value);
        if (url.username || url.password || url.search || url.hash || url.pathname !== "/" || (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))) throw new Error("Invalid engine origin");
        result[key] = url.origin;
      }
    }
    return result;
  } catch { throw new ReviewError(503, "Repository routing is unavailable. Check the review service configuration."); }
}
export function runtimeEngineOrigin(env: Environment = process.env): string | undefined {
  // The deployment controller owns this atomic pointer. The retiring Go host
  // can continue writing its old routes without stealing new admissions.
  if (env.INKSPECT_ENGINE_RUNTIME_FILE) {
    try {
      const runtime = JSON.parse(readFileSync(resolve(/*turbopackIgnore: true*/ env.INKSPECT_ENGINE_RUNTIME_FILE), "utf8"));
      if (runtime.origin) {
        const url = new URL(runtime.origin);
        if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error();
        return url.origin;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new ReviewError(503, 'Engine routing is unavailable.');
    }
  }
  return undefined;
}
export function engineOrigin(tenant: string, repository: number, env: Environment = process.env) {
  return runtimeEngineOrigin(env) || engineRoutes(env)[`${tenant}:${repository}`] || env.INKSPECT_ENGINE_URL?.trim();
}
