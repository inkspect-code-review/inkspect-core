import assert from "node:assert/strict";
import test from "node:test";
import { mergeRepositoryIndex, indexLogKey, hasFileCounts } from "../../src/lib/repository-activity";
import type { RepositoryIndex } from "../../src/lib/repository-types";
function snapshot(logs: RepositoryIndex["progress"]["logs"], updated = "2026-10-26T01:40:00Z", id = "run-1"): RepositoryIndex {
  return { id, status: "running", created_at: "2026-10-26T01:38:00Z", updated_at: updated, progress: { stage: "reading", scan: { stage: "reading", total: 230, processed: 0, read: 0, skipped: 0, chunks: 0 }, chunks: 0, embedded: 0, reused: 0, indexed: false, logs } };
}
test("file counters distinguish unmeasured legacy zeros from measured empty repositories", () => {
  const progress = snapshot([]).progress;
  assert.equal(hasFileCounts(progress), true);
  progress.scan = { ...progress.scan, stage: '', total: 0 };
  progress.chunks = 929;
  assert.equal(hasFileCounts(progress), false);
  progress.scan.measured = true;
  assert.equal(hasFileCounts(progress), true);
});
test("old-worker snapshots cannot evict observed milestones and update progress in place", () => {
  const queued = { at: "2026-10-26T01:38:00Z", message: "Index queued." };
  const analyzing = { at: "2026-10-26T01:38:01Z", message: "Analyzing repository and resolving its default branch." };
  const scanning = { at: "2026-10-26T01:38:02Z", message: "Scanning files: 230 found." };
  let state = mergeRepositoryIndex(null, snapshot([queued, analyzing, scanning, { at: "2026-10-26T01:39:00Z", message: "Reading files: 0/230 processed." }]));
  const key = indexLogKey(state!.progress.logs[3]);
  state = mergeRepositoryIndex(state, snapshot([{ at: "2026-10-26T01:41:00Z", message: "Reading files: 140/230 processed." }], "2026-10-26T01:41:00Z"));
  assert.equal(state!.progress.logs.length, 4);
  assert.deepEqual(state!.progress.logs.slice(0, 3).map(row => row.message), [queued.message, analyzing.message, scanning.message]);
  assert.equal(state!.progress.logs[3].message, "Reading files: 140/230 processed.");
  assert.equal(indexLogKey(state!.progress.logs[3]), key);
  // Updated workers use the same keys, without duplicating legacy progress.
  state = mergeRepositoryIndex(state, snapshot([{ key: "progress:reading", at: "2026-10-26T01:42:00Z", message: "Reading files: 230/230 processed." }, { at: "2026-10-26T01:42:00Z", message: "Index saved." }], "2026-10-26T01:42:00Z"));
  assert.equal(state!.progress.logs.length, 5);
  assert.equal(state!.progress.logs[4].message, "Index saved.");
});
test("stale snapshots cannot roll back progress and a new run starts its own history", () => {
  const current = snapshot([{ at: "now", message: "Reading files: 140/230 processed." }]);
  assert.equal(mergeRepositoryIndex(current, snapshot([{ at: "old", message: "Reading files: 1/230 processed." }], "2026-10-26T01:39:00Z")), current);
  const next = mergeRepositoryIndex(current, snapshot([{ at: "new", message: "Index queued." }], "2026-10-26T01:42:00Z", "run-2"));
  assert.equal(next!.progress.logs.length, 1);
  assert.equal(next!.progress.logs[0].message, "Index queued.");
});
