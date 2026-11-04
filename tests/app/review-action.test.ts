import assert from "node:assert/strict";
import test from "node:test";
import { reviewAction } from "../../src/lib/review-action";
import type { OpenPull, ReviewJob } from "../../src/lib/review-types";
const pull: OpenPull = { number: 3, title: "Review", url: "https://github.com/acme/repo/pull/3", draft: false, base_tip: "a".repeat(40), head: "b".repeat(40) };
const row = (id: string, status: string, time: number): ReviewJob => ({ job: { id, status, attempts: 1, cancel_requested: status === "cancelled", created_at: new Date(time).toISOString() }, snapshot: { repository_id: "17", url: pull.url, base_tip: pull.base_tip, base: pull.base_tip, head: pull.head } });
test("retry targets the latest cancelled child instead of the original failed job", () => {
  assert.deepEqual(reviewAction([row("original", "failed", 1), row("child", "cancelled", 2)], pull, 17), { kind: "retry", label: "Retry review", jobId: "child" });
});
test("active and completed attempts open the existing review without another admission", () => {
  for (const status of ["queued", "leased", "running", "completed"]) assert.deepEqual(reviewAction([row("original", "failed", 1), row("latest", status, 2)], pull, 17), { kind: "view", label: "View review", jobId: "latest" });
  assert.equal(reviewAction([row("active", "running", 1), row("failed", "failed", 2)], pull, 17).kind, "view");
});
test("different repository, PR, base or head never reuses a previous attempt", () => {
  const previous = row("old", "failed", 1);
  for (const next of [{ ...pull, head: "c".repeat(40) }, { ...pull, base_tip: "c".repeat(40) }, { ...pull, url: "https://github.com/acme/repo/pull/4" }]) assert.equal(reviewAction([previous], next, 17).kind, "start");
  assert.equal(reviewAction([previous], pull, 18).kind, "start");
  assert.equal(reviewAction([], pull, 17).kind, "start");
});

test("model selection keeps histories and retries separate for the same snapshot", () => {
  const previous = row("model-a-review", "completed", 1);
  previous.snapshot.review_model_id = "model-a";
  assert.equal(reviewAction([previous], pull, 17, "model-a").kind, "view");
  assert.equal(reviewAction([previous], pull, 17, "model-b").kind, "start");
  assert.equal(reviewAction([previous], pull, 17, "").kind, "start");
  previous.job.status = "failed";
  assert.equal(reviewAction([previous], pull, 17, "model-a").kind, "retry");
  assert.equal(reviewAction([row("legacy", "paused", 1)], pull, 17, "").kind, "view");
});
test("changing BYOK credentials starts a new review instead of retrying an obsolete key",()=>{
  const previous=row("old-key","failed",1);previous.snapshot.byok={credential_id:"old",provider:"openai",model:"gpt-6.1-sol"};
  assert.equal(reviewAction([previous],pull,17,"","old").kind,"retry");
  assert.equal(reviewAction([previous],pull,17,"","new").kind,"start");
  assert.equal(reviewAction([previous],pull,17,"","").kind,"start");
});
