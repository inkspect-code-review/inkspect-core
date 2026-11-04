import assert from "node:assert/strict";
import test from "node:test";
import { buildOverview, type OverviewRepositoryJobs, type ReportDigest } from "../../src/lib/review-overview";
import type { ReviewJob } from "../../src/lib/review-types";

const now = new Date("2026-10-30T12:00:00Z");
const review = (number: number, date: string, status = "completed"): ReviewJob => ({
  job: { id: `J-${number}`, status, created_at: date, attempts: 1, cancel_requested: false },
  snapshot: { url: `https://github.com/team/app/pull/${number}`, repository_id: "17", base_tip: "a", base: "a", head: "b" },
});
const reviews = [review(2, "2026-10-30T10:00:00Z"), review(1, "2026-10-29T10:00:00Z")];
const digest: ReportDigest = { decision: "needs_changes", severities: { critical: 0, high: 0, medium: 1, low: 0 } };
const digests = new Map(reviews.map(row => [row.job.id, digest]));
const repository = (): OverviewRepositoryJobs => ({ repositoryId: 17, fullName: "team/app", reviews });
const options = { now, unavailable: 0 };

test("dashboard uses saved reviews even when PRs have since closed", () => {
  const result = buildOverview([repository()], digests, { ...options, recent: 1 });
  assert.equal(result.latest?.number, 2);
  assert.deepEqual(result.recent.map(row => row.number), [2]);
  assert.equal(result.totals.completed, 2);
  assert.equal(result.totals.findings, 2);
  assert.equal(result.severities.medium, 2);
  assert.equal(result.daily.reduce((sum, day) => sum + day.completed, 0), 2);
});

test("saved history without a GitHub PR listing preserves review cards", () => {
  const result = buildOverview([repository()], digests, options);
  assert.equal(result.latest?.number, 2);
  assert.deepEqual(result.recent.map(row => row.number), [2, 1]);
  assert.equal(result.totals.completed, 2);
  assert.equal(result.unverified, 0);
});

test("reviews with missing PR URLs still contribute cards and metrics", () => {
  const result = buildOverview([{ ...repository(), reviews: reviews.map(row => ({ ...row, snapshot: { ...row.snapshot, url: "" } })) }], digests, options);
  assert.equal(result.latest?.number, null);
  assert.equal(result.recent.length, 2);
  assert.equal(result.unverified, 0);
  assert.equal(result.totals.completed, 2);
});

test("saved review cards remain scoped to their repository", () => {
  const result = buildOverview([repository(), { ...repository(), repositoryId: 18, fullName: "other/app" }], digests, options);
  assert.equal(result.latest?.repositoryId, 17);
  assert.deepEqual(result.recent.map(row => row.repositoryId), [17, 18, 17, 18]);
});
