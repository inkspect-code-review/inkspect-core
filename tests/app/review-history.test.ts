import assert from "node:assert/strict";
import test from "node:test";
import { newestReviews, selectedReviewId, reviewsWithLinkedJob } from "../../src/lib/review-history";
import type { ReviewJob } from "../../src/lib/review-types";

const row = (id: string, created_at: string) => ({ job: { id, created_at } }) as ReviewJob;
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
