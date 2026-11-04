import type { RepositoryIndex } from "./repository-types";
type IndexLog = RepositoryIndex["progress"]["logs"][number];

export function hasFileCounts(progress: RepositoryIndex['progress']) {
  // Older Go workers did not set measured, but did publish their scan stage.
  return !!progress.scan.measured || !!progress.scan.stage || progress.scan.total > 0;
}

export function indexLogKey(log: IndexLog) {
  if (log.key) return log.key;
  // Older workers publish append-only snapshots. Keep their milestone history
  // while updating the three known progress rows in place.
  if (log.message.startsWith("Scanning files:")) return "progress:discovering";
  if (log.message.startsWith("Reading files:")) return "progress:reading";
  if (log.message.startsWith("Indexing chunks:")) return "progress:embedding";
  return `event:${log.at}:${log.message}`;
}
export function mergeRepositoryIndex(previous: RepositoryIndex | null, next: RepositoryIndex | null): RepositoryIndex | null {
  if (!next) return null;
  const sameRun = previous?.id === next.id;
  if (sameRun && Date.parse(previous.updated_at) > Date.parse(next.updated_at)) return previous;
  const logs: IndexLog[] = [];
  const positions = new Map<string, number>();
  for (const log of [...(sameRun ? previous.progress.logs ?? [] : []), ...(next.progress.logs ?? [])]) {
    const key = indexLogKey(log);
    const position = positions.get(key);
    if (position === undefined) { positions.set(key, logs.length); logs.push({ ...log, key }); }
    else logs[position] = { ...log, key };
  }
  return { ...next, progress: { ...next.progress, logs } };
}
