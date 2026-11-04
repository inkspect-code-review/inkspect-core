import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { sanitize } from "./sanitize";

type Context = { requestId: string; method: string; path: string };
type State = { context: AsyncLocalStorage<Context>; installed?: boolean; writing?: boolean; lastCleanup?: number };
const globals = globalThis as typeof globalThis & { inkspectDiagnostics?: State };
const state = globals.inkspectDiagnostics ??= { context: new AsyncLocalStorage<Context>() };
export const diagnosticContext = state.context;
export function diagnosticsEnabled() { return process.env.NODE_ENV === "development" && process.env.INKSPECT_DEV_LOGS !== "false"; }
export function diagnosticsDirectory() { return resolve(/*turbopackIgnore: true*/ process.env.INKSPECT_DEV_LOG_DIR || ".local/logs"); }
function secrets() {
  return Object.entries(process.env).flatMap(([key, value]) => {
    if (!value || !/SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY|DATABASE_URL/i.test(key)) return [];
    try { const url = new URL(value); return [value, decodeURIComponent(url.password)].filter(Boolean); } catch { return [value]; }
  });
}
export function writeDiagnostic(event: string, error?: unknown, context: Record<string, unknown> = {}, source = "server", level: "error" | "warn" = "error") {
  const id = randomUUID();
  if (!diagnosticsEnabled() || state.writing) return id;
  state.writing = true;
  try {
    const record = { timestamp: new Date().toISOString(), id, pid: process.pid, source, level, event,
      context: { ...context, ...diagnosticContext.getStore() }, error };
    const line = JSON.stringify(sanitize(record, secrets()));
    const directory = diagnosticsDirectory();
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    // Each process owns its rotation, avoiding collisions with Next workers.
    const file = join(directory, `events-${process.pid}.jsonl`);
    if (!state.lastCleanup || Date.now() - state.lastCleanup > 60_000) {
      const files = readdirSync(directory).filter((name) => /^events-\d+\.jsonl(?:\.[1-3])?$/.test(name))
        .map((name) => ({ name, time: statSync(join(directory, name)).mtimeMs })).sort((a, b) => b.time - a.time);
      for (const [index, item] of files.entries()) if (index >= 20 || Date.now() - item.time > 7 * 86400_000) unlinkSync(join(directory, item.name));
      state.lastCleanup = Date.now();
    }
    let size = 0; try { size = statSync(file).size; } catch { /* First event. */ }
    if (size > 5 * 1024 * 1024) {
      for (let i = 3; i >= 1; i--) {
        const from = i === 1 ? file : `${file}.${i - 1}`;
        try { renameSync(from, `${file}.${i}`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
    }
    // Synchronous error-only writes survive process termination; logging never
    // throws into the application or changes the outcome of a payment/request.
    appendFileSync(file, (line.length <= 64_000 ? line : JSON.stringify({ timestamp: record.timestamp, id, source, level, event: "diagnostics.oversize", error: "[Record exceeded limit]" })) + "\n", { mode: 0o600 });
  } catch {
    // Do not recurse through console interception or print the original error.
    process.stderr.write("Inkspect diagnostics could not write its local log directory.\n");
  } finally { state.writing = false; }
  return id;
}
export function captureError(event: string, error: unknown, context: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV === "production") console.error(JSON.stringify(sanitize({ event, error, context }, secrets())));
  return writeDiagnostic(event, error, context);
}
export function installDiagnostics() {
  if (!diagnosticsEnabled() || state.installed) return;
  state.installed = true;
  for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      writeDiagnostic(`console.${level}`, args, {}, "server", level);
      original(...args);
    };
  }
  // Monitor without swallowing the crash or changing Node's rejection policy.
  process.on("uncaughtExceptionMonitor", (error, origin) => captureError("process.uncaught", error, { origin }));
}
