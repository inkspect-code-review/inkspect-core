import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const explicitDirectory = option("--directory");
const directories = [...new Set((explicitDirectory ? [explicitDirectory] : [process.env.INKSPECT_DEV_LOG_DIR || ".local/logs"]).map(path => resolve(path)))];
const search = option("--search");
const request = option("--request");
const job = option("--job");
const limit = Math.max(1, Math.min(1000, Number(option("--limit")) || 30));
const seen = new Set<string>();
function print(initial: boolean) {
  const records: { id: string; timestamp: string; source: string; level: string; event: string; context?: { requestId?: string; jobId?: string }; error?: unknown }[] = [];
  for (const directory of directories.filter(existsSync)) for (const name of readdirSync(directory).filter((name) => /^events-\d+\.jsonl(?:\.[1-3])?$/.test(name))) {
    let content: string; try { content = readFileSync(join(directory, name), "utf8"); } catch { continue; }
    for (const line of content.split("\n")) {
      if (!line) continue;
      try { const record = JSON.parse(line); if ((!search || line.toLowerCase().includes(search.toLowerCase())) && (!request || record.context?.requestId === request) && (!job || record.context?.jobId === job)) records.push(record); } catch { /* Ignore incomplete concurrent writes. */ }
    }
  }
  const fresh = records.sort((a, b) => a.timestamp.localeCompare(b.timestamp)).filter((record) => !seen.has(record.id));
  // Bound memory while following; retained files already have a disk limit.
  seen.clear(); for (const record of records) seen.add(record.id);
  for (const record of initial ? fresh.slice(-limit) : fresh) {
    if (args.includes("--json")) console.log(JSON.stringify(record));
    else console.log(`${record.timestamp} ${record.source} ${record.level} ${record.event}\n${JSON.stringify({ id: record.id, ...record.context, error: record.error }, null, 2)}\n`);
  }
  if (initial && !fresh.length) console.log(`No matching errors. Directories: ${directories.join(", ")}`);
}
print(true);
if (args.includes("--follow")) setInterval(() => print(false), 1500);
