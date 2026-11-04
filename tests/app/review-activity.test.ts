import assert from "node:assert/strict";
import test from "node:test";
import { mergeActivity, activityLabel, type ReviewActivityEvent } from "../../src/lib/review-activity";
const row = (sequence: number): ReviewActivityEvent => ({ sequence, created_at: "2026-10-25T00:00:00Z", event: { kind: "model.completed", call: sequence } });
test("reconnect pages merge without duplicated or reordered activity", () => {
  const result = mergeActivity([row(2), row(1)], [row(2), row(3), row(-1), row(2004)]);
  assert.deepEqual(result.map((r) => r.sequence), [1, 2, 3]);
  assert.equal(activityLabel(result[2]), "Codex response validated · call 3");
});
