import { randomUUID } from "node:crypto";
import { captureError, diagnosticContext, diagnosticsEnabled } from "./server";
import { safePath } from "./sanitize";

export function observeRoute<T extends Request>(handler: (request: T) => Response | Promise<Response>) {
  return async (request: T) => {
    if (!diagnosticsEnabled()) return handler(request);
    const requestId = randomUUID();
    return diagnosticContext.run({ requestId, method: request.method, path: safePath(request.url) }, async () => {
      const start = Date.now();
      try {
        const response = await handler(request);
        if (response.status >= 400) captureError("http.failure", new Error(`HTTP ${response.status}`), { status: response.status, durationMs: Date.now() - start });
        try { response.headers.set("x-inkspect-request-id", requestId); } catch { /* Some framework responses have immutable headers. */ }
        return response;
      } catch (error) {
        const digest = error && typeof error === "object" && "digest" in error ? String(error.digest) : "";
        if (!/^(NEXT_REDIRECT|NEXT_HTTP_ERROR_FALLBACK);/.test(digest)) captureError("http.exception", error, { durationMs: Date.now() - start });
        throw error;
      }
    });
  };
}
