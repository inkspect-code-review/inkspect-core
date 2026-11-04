import { captureError } from "./diagnostics/server";
import { Pool } from "pg";
const state = globalThis as typeof globalThis & { inkspectBillingPool?: Pool };
export function applicationPool() {
  if (!process.env.DATABASE_URL) throw new Error("Application database is not configured.");
  if (!state.inkspectBillingPool) {
    state.inkspectBillingPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8, connectionTimeoutMillis: 5000, statement_timeout: 10_000 });
    state.inkspectBillingPool.on("error", (error) => captureError("application.database", error));
  }
  return state.inkspectBillingPool;
}
export async function closeApplicationPool() {
  const pool = state.inkspectBillingPool;
  delete state.inkspectBillingPool;
  if (pool) await pool.end();
}
