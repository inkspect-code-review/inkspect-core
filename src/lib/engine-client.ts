import { engineOrigin } from "./engine-routing";
import { captureError } from "./diagnostics/server";
import { safePath } from "./diagnostics/sanitize";
import { createHash, createHmac } from "node:crypto";
import { ReviewError } from "./review-access";

export type EngineClaims = { tenant: string; subject: string; connection: string; installation: number; repository: number; expires: number };
export function signEngineRequest(method: string, path: string, body: string, claims: EngineClaims, secret: string) {
  const encoded = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const digest = createHash("sha256").update(body).digest("hex");
  return { "X-Inkspect-Claims": encoded, "X-Inkspect-Signature": createHmac("sha256", secret.trim()).update(`${method}\n${path}\n${encoded}\n${digest}`).digest("hex") };
}
export async function engineRequest(path: string, method: "GET" | "POST", body: object | undefined, claims: Omit<EngineClaims, "expires">, fetcher = fetch, env = process.env) {
  const origin = engineOrigin(claims.tenant, claims.repository, env);
  const secret = env.INKSPECT_ENGINE_SECRET?.trim();
  if (!origin || !secret || secret.length < 32) throw new ReviewError(503, "Manual reviews are not configured yet.");
  const url = new URL(origin);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" || (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))) throw new ReviewError(503, "The review service configuration is invalid.");
  const data = body ? JSON.stringify(body) : "";
  const response = await fetcher(new URL(path, url), { method, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(path === "/chat/context" || path === "/chat/source" ? 85_000 : path.startsWith("/github/models") || path === "/github/reviews" ? 30_000 : 15_000), headers: { "Content-Type": "application/json", ...signEngineRequest(method, path, data, { ...claims, expires: Math.floor(Date.now() / 1000) + 30 }, secret) }, ...(data ? { body: data } : {}) });
  const reader = response.body?.getReader();
  if (!reader) throw new ReviewError(502, "The review service returned an empty response.");
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > 8 * 1024 * 1024) { await reader.cancel(); throw new ReviewError(502, "The report is too large to display."); }
    chunks.push(value);
  }
  const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!response.ok) captureError("engine.response", new Error(typeof result.error === "string" ? result.error : "Review engine request failed"), { upstreamPath: safePath(path), status: response.status, connectionId: claims.connection, installationId: claims.installation, repositoryId: claims.repository, engineOrigin: url.origin });
  if (!response.ok) throw new ReviewError([400, 402, 403, 404, 409, 429, 503].includes(response.status) ? response.status : 502, typeof result.error === "string" ? result.error : "Could not load the review.");
  return result;
}
