import assert from "node:assert/strict";
import test from "node:test";
import { newestReviews, selectedReviewId, reviewsWithLinkedJob, reviewsWithFindingSummaries, summarizeOpenFindings } from "../../src/lib/review-history";
import { buildFindingLifecycle, type FindingReviewRecord } from "../../src/lib/finding-status";
import type { ReviewJob } from "../../src/lib/review-types";

const row = (id: string, created_at: string) => ({ job: { id, created_at } }) as ReviewJob;
test("history badges count only open findings and use the severity of remaining open findings", () => {
  const current: FindingReviewRecord = { id: "current", status: "completed", createdAt: "2026-11-17T12:00:00Z", url: "https://github.com/example/repo/pull/1", head: "a".repeat(40), base: "b".repeat(40), valid: true, coverageComplete: true, excludedFiles: 0, blockingGaps: false, findings: [{ id: "F1", severity: "P1" }, { id: "F2", severity: "P2" }] };
  const older = { ...current, id: "older", createdAt: "2026-11-16T12:00:00Z" };
  const rows = [current, older].map(record => ({ ...row(record.id, record.createdAt), job: { ...row(record.id, record.createdAt).job, status: "completed" } }));
  let lifecycle = buildFindingLifecycle([current, older]);
  assert.deepEqual(reviewsWithFindingSummaries(rows, lifecycle).map(row => row.finding_summary), [{ open: 2, urgent: true }, { open: 0, urgent: false }]);
  lifecycle = buildFindingLifecycle([current, older], [{ jobId: "current", ordinal: 1, findingId: "F1", resolvedAt: "2026-11-17T13:00:00Z" }]);
  assert.deepEqual(reviewsWithFindingSummaries(rows, lifecycle)[0].finding_summary, { open: 1, urgent: false });
  assert.equal(reviewsWithFindingSummaries(rows, buildFindingLifecycle([]))[0].finding_summary, undefined, "missing lifecycle data must not imply zero findings");
  assert.deepEqual(summarizeOpenFindings([{ severity: "critical" }, { severity: "low" }]), { open: 2, urgent: true });
  assert.equal(rows[0].finding_summary, undefined, "enrichment must not mutate shared history");
});
test("review history sorts timestamps across offsets and selects the latest regardless of worker order", () => {
  const rows = [row("old", "2026-10-29T10:00:00Z"), row("invalid", "invalid"), row("latest", "2026-10-29T12:30:00+01:00"), row("middle", "2026-10-29T11:00:00Z")];
  assert.deepEqual(newestReviews(rows).map(r => r.job.id), ["latest", "middle", "old", "invalid"]);
  assert.equal(rows[0].job.id, "old", "sorting must not mutate shared state");
  assert.equal(selectedReviewId(rows, ""), "latest");
  assert.equal(selectedReviewId(rows, "missing"), "latest");
  assert.equal(selectedReviewId(rows, "middle"), "middle", "polling must preserve an explicitly viewed older review");
  assert.equal(selectedReviewId(rows, "middle", "old"), "old", "deep links override the default selection");
  assert.equal(selectedReviewId([], "old"), "");
});

test("findings links load an older review outside recent history and keep it selected on refresh", async () => {
  const linked = { jobId: "old", repositoryId: 17 };
  const old = { ...row("old", "2026-09-01"), snapshot: { repository_id: "17" } } as ReviewJob;
  const rows = [row("latest", "2026-10-30")];
  const loaded = await reviewsWithLinkedJob(rows, linked, async () => old);
  assert.equal(selectedReviewId(loaded, "", linked.jobId), "old");
  assert.equal(selectedReviewId(await reviewsWithLinkedJob(rows, linked, async () => old), "old"), "old");
  await reviewsWithLinkedJob(loaded, linked, async () => { throw new Error("Already in history"); });
  await assert.rejects(reviewsWithLinkedJob(rows, linked, async () => ({ ...old, snapshot: { ...old.snapshot, repository_id: "18" } })), /could not be loaded/);
});
