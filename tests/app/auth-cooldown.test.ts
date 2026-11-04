import assert from "node:assert/strict";
import test from "node:test";
import { remainingSeconds, retryDeadline } from "../../src/lib/auth-cooldown";

test("uses the server's remaining seconds instead of restarting a minute", () => {
  const now = 1_700_000_000_000;
  const deadline = retryDeadline(new Headers({ "x-retry-after": "7" }), now);
  assert.equal(remainingSeconds(deadline, now), 7);
  assert.equal(remainingSeconds(deadline, now + 1001), 6);
  assert.equal(remainingSeconds(deadline, now + 6999), 1);
  assert.equal(remainingSeconds(deadline, now + 7000), 0);
  // Timers paused by a background tab must not leave the button blocked.
  assert.equal(remainingSeconds(deadline, now + 30_000), 0);
});

test("supports standard Retry-After seconds and HTTP dates", () => {
  const now = Date.parse("2026-10-24T22:00:00Z");
  assert.equal(retryDeadline(new Headers({ "Retry-After": "12" }), now), now + 12_000);
  assert.equal(retryDeadline(new Headers({ "Retry-After": "Sat, 24 Oct 2026 22:00:09 GMT" }), now), now + 9000);
  assert.equal(retryDeadline(new Headers({ "x-retry-after": "0" }), now), now);
});

test("missing or invalid timing headers use the configured auth window", () => {
  for (const value of ["", "invalid", "-1", "Infinity"]) {
    assert.equal(retryDeadline(new Headers({ "x-retry-after": value }), 1000), 61_000);
  }
});
