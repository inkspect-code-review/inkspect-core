import assert from "node:assert/strict";
import test from "node:test";
import { buildFindingLifecycle, type FindingReviewRecord } from "../../src/lib/finding-status";

const sha = (letter: string) => letter.repeat(40);
const review = (id: string, time: number, patch: Partial<FindingReviewRecord> = {}): FindingReviewRecord => ({
  id, createdAt: new Date(Date.UTC(2026, 9, 30, time)).toISOString(), status: "completed", valid: true,
  url: "https://github.com/team/repo/pull/3", head: sha("a"), base: sha("b"), coverageComplete: true,
  excludedFiles: 0, blockingGaps: false, findings: [{ id: "F-critical", severity: "P0" }], ...patch,
});
const verifiedFix = (id: string, time: number, source: FindingReviewRecord, commit: string): FindingReviewRecord => review(id, time, {
  valid: false, findings: [], head: source.head, fixOf: source.id, fixCommit: commit,
  verification: { version: 3, status: "passed", attempts: 1, findings: source.findings.length, candidate_sha256: "a".repeat(64) },
});

test("a clean later review clears current counts without claiming that older findings were verified fixed", () => {
  const old = review("old", 1), clean = review("clean", 2, { findings: [], head: sha("c") });
  const original = JSON.stringify([old, clean]);
  const result = buildFindingLifecycle([old, clean]);
  assert.equal(result.summary.open, 0); assert.equal(result.summary.severities.critical, 0);
  assert.equal(result.summary.resolved, 0); assert.equal(result.summary.notDetected, 1);
  assert.deepEqual(result.statuses.old[0], { status: "not_detected", source: "latest_review", reviewId: "clean", commit: sha("c"), at: clean.createdAt });
  assert.equal(JSON.stringify([old, clean]), original, "the recorded reviews remain unchanged");
});

test("latest-review selection preserves microseconds rather than breaking timestamp ties by job ID", () => {
  const older = review("z-older", 1, { createdAt: "2026-10-30T01:00:00.123455Z" });
  const newer = review("a-newer", 1, { createdAt: "2026-10-30T02:00:00.123457+01:00", findings: [] });
  const result = buildFindingLifecycle([newer, older]);
  assert.deepEqual(result.latestIds, [newer.id]);
  assert.equal(result.summary.open, 0); assert.equal(result.summary.notDetected, 1);
});

test("successful committed verification chains resolve their exact source findings", () => {
  const first = review("first", 1);
  const fix1 = verifiedFix("fix1", 2, first, sha("c"));
  const second = review("second", 3, { head: sha("c"), findings: [{ id: "F-next", severity: "P2" }] });
  const fix2 = verifiedFix("fix2", 4, second, sha("d"));
  const clean = review("clean", 5, { head: sha("d"), findings: [] });
  const result = buildFindingLifecycle([first, fix1, second, fix2, clean]);
  assert.equal(result.summary.verifiedResolved, 2);
  assert.equal(result.statuses.first[0].source, "verified_fix");
  assert.equal(result.statuses.second[0].commit, sha("d"));
  assert.equal(result.statuses.second[0].reviewId, "clean");
  assert.equal(result.summary.open, 0);
});

test("a verified committed fix resolves its source immediately without requiring another review", () => {
  const source = review("source", 1), fix = verifiedFix("fix", 2, source, sha("c"));
  const result = buildFindingLifecycle([source, fix]);
  assert.equal(result.summary.open, 0); assert.equal(result.summary.verifiedResolved, 1);
  assert.equal(result.statuses.source[0].commit, sha("c"));
  assert.equal(result.summary.severities.critical, 0);
});

test("missing, failed, partial or mismatched verification never becomes a verified resolution", () => {
  const source = review("source", 1), clean = review("clean", 4, { head: sha("c"), findings: [] });
  for (const patch of [{ status: "failed" }, { verification: null }, { verification: { status: "passed", version: 3, attempts: 1, findings: 99, candidate_sha256: "a".repeat(64) } }, { head: sha("d") }, { fixCommit: sha("d") }]) {
    const fix = { ...verifiedFix("fix", 2, source, sha("c")), ...patch };
    assert.equal(buildFindingLifecycle([source, fix, clean]).summary.verifiedResolved, 0);
  }
});

test("failed or invalid reports do not supersede a completed review, and incomplete coverage does not imply absence", () => {
  const source = review("source", 1);
  for (const patch of [{ status: "failed" }, { valid: false }]) {
    const result = buildFindingLifecycle([source, review("later", 2, { findings: [], ...patch })]);
    assert.equal(result.statuses.source[0].status, "open");
    assert.equal(result.summary.severities.critical, 1);
  }
  for (const patch of [{ coverageComplete: false }, { excludedFiles: 1 }, { blockingGaps: true }, { base: sha("c") }]) {
    const result = buildFindingLifecycle([source, review("later", 2, { findings: [], ...patch })]);
    assert.equal(result.statuses.source[0].status, "historical");
    assert.equal(result.summary.notDetected, 0);
  }
});

test("PRs and unknown PR identities remain independent, and a later reappearance counts as open", () => {
  const source = review("source", 1), other = review("other", 2, { url: "https://github.com/team/repo/pull/4", findings: [] });
  assert.equal(buildFindingLifecycle([source, other]).statuses.source[0].status, "open");
  assert.equal(buildFindingLifecycle([{ ...source, url: "" }, { ...other, url: "" }]).statuses.source[0].status, "open");
  const fixed = verifiedFix("fix", 2, source, sha("c"));
  const reopened = review("reopened", 3, { head: sha("d") });
  const result = buildFindingLifecycle([source, fixed, reopened]);
  assert.equal(result.summary.open, 1); assert.equal(result.summary.verifiedResolved, 0);
});

test("manual resolution is reversible, scoped to a recorded finding and distinct from verified repair", () => {
  const source = review("source", 1);
  const manual = { jobId: source.id, ordinal: 1, findingId: "F-critical", resolvedAt: "2026-11-02T00:00:00Z" };
  const result = buildFindingLifecycle([source], [manual]);
  assert.equal(result.statuses.source[0].source, "manual");
  assert.equal(result.summary.open, 0); assert.equal(result.summary.severities.critical, 0);
  assert.equal(result.summary.manualResolved, 1); assert.equal(result.summary.verifiedResolved, 0);
  assert.equal(buildFindingLifecycle([source]).statuses.source[0].status, "open");
  assert.equal(buildFindingLifecycle([source], [{ ...manual, findingId: "wrong" }]).summary.open, 1);
  assert.equal(buildFindingLifecycle([source], [{ ...manual, ordinal: 2 }]).summary.open, 1);
});
