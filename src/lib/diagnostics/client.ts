import { safePath, sanitize } from "./sanitize";
const endpoint = "/api/dev/errors";
type BrowserState = { installed?: boolean; sender?: typeof fetch; windowStart: number; count: number };
const browser = globalThis as typeof globalThis & { inkspectBrowserDiagnostics?: BrowserState };
const state = browser.inkspectBrowserDiagnostics ??= { windowStart: 0, count: 0 };
export function reportBrowserError(event: string, error: unknown, context: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV !== "development" || typeof window === "undefined" || !state.sender) return;
  if (Date.now() - state.windowStart > 60_000) { state.windowStart = Date.now(); state.count = 0; }
  if (error && typeof error === "object" && "name" in error && error.name === "AbortError") return;
  if (++state.count > 60) return;
  try {
    const body = JSON.stringify(sanitize({ event, error, context: { ...context, page: safePath(window.location.href) } }));
    if (new TextEncoder().encode(body).length > 32_000) return;
    // Use the original fetch: diagnostics failures must never report themselves.
    void state.sender(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body, credentials: "same-origin", keepalive: true }).catch(() => {});
  } catch { /* Diagnostics must never break the application. */ }
}
export function installBrowserDiagnostics() {
  if (process.env.NODE_ENV !== "development" || typeof window === "undefined" || state.installed) return;
  state.installed = true;
  state.sender = window.fetch.bind(window);
  window.addEventListener("error", (event) => {
    reportBrowserError("browser.error", event.error || new Error(event.message || "Resource could not load"), { file: event.filename ? safePath(event.filename) : undefined, line: event.lineno, column: event.colno });
  }, true);
  window.addEventListener("unhandledrejection", (event) => reportBrowserError("browser.unhandledrejection", event.reason));
  for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => { reportBrowserError(`browser.console.${level}`, args); original(...args); };
  }
  const originalFetch = state.sender;
  window.fetch = async (input, init) => {
    let url: URL | undefined;
    try { url = new URL(input instanceof Request ? input.url : String(input), window.location.href); } catch { /* Let fetch validate. */ }
    const track = url?.origin === window.location.origin && url.pathname !== endpoint;
    try {
      const response = await originalFetch(input, init);
      if (track && response.status >= 400) reportBrowserError("browser.http", new Error(`HTTP ${response.status}`), { path: url!.pathname, status: response.status, requestId: response.headers.get("x-inkspect-request-id") });
      return response;
    } catch (error) {
      if (track && !(error instanceof DOMException && error.name === "AbortError")) reportBrowserError("browser.network", error, { path: url!.pathname });
      throw error;
    }
  };
}
