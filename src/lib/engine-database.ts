import { Pool } from "pg";
export const pools = new Map<string, Pool>();
export function database(key = "app") {
  if (!['app', 'legacy'].includes(key)) throw new Error('Unknown queue database');
  let pool = pools.get(key);
  if (!pool) {
    const connectionString = key === 'app' ? process.env.DATABASE_URL : process.env.INKSPECT_LEGACY_DATABASE_URL;
    if (!connectionString) throw new Error('Database is not configured');
    pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 3000, statement_timeout: 8000 });
    pool.on('error', () => console.error(JSON.stringify({ event: 'database.connection_lost', database: key })));
    pools.set(key, pool);
  }
  return pool;
}
export async function closeDatabases() { await Promise.all([...pools.values()].map(pool => pool.end())); pools.clear(); }
