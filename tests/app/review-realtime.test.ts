import assert from "node:assert/strict";
import test from "node:test";
import { subscribeReviews } from "../../src/lib/review-realtime";

test("Pubb reauthorizes the exact channel, handles malformed packets and tears down", async () => {
  const sent: unknown[] = []; let closed = 0, refreshed = 0, activity = 0, indexed = 0;
  const states: string[] = [], messages: string[] = [];
  const socket = { readyState: 1, onmessage: null, onerror: null, onclose: null, send: (data: string) => sent.push(JSON.parse(data)), close: () => { closed++; } } as unknown as WebSocket;
  const stop = subscribeReviews({ channel: "private-reviews-test", organizationId: "org", onRefresh: () => { refreshed++; }, onActivity: () => { activity++; }, onIndex: () => { indexed++; }, onState: (s) => states.push(s), onMessage: (m) => messages.push(m) }, () => socket, async (url, options) => {
    assert.ok(String(url).includes("organizationId=org"));
    assert.deepEqual(JSON.parse(String(options?.body)), { socket_id: "new.socket", channel_name: "private-reviews-test" });
    return Response.json({ auth: "signature" });
  }, "synthetic-test-key");
  const emit = async (packet: unknown) => socket.onmessage?.call(socket, { data: typeof packet === "string" ? packet : JSON.stringify(packet) } as MessageEvent);
  await emit("malformed");
  await emit({ event: "pubb:connection_established", data: JSON.stringify({ socket_id: "new.socket" }) });
  assert.deepEqual(sent, [{ action: "subscribe", channel: "notifications" }, { action: "subscribe", channel: "private-reviews-test", auth: "signature" }]);
  await emit({ event: "pubb:subscription_succeeded", channel: "private-reviews-test", data: "{}" });
  await emit({ channel: "private-reviews-other", data: JSON.stringify({ name: "review.changed", data: {} }) });
  assert.equal(refreshed, 1);
  await emit({ channel: "private-reviews-test", data: JSON.stringify({ name: "review.changed", data: {} }) });
  assert.equal(refreshed, 2);
  await emit({ channel: "private-reviews-test", data: JSON.stringify({ name: "review.activity", data: {} }) });
  assert.equal(activity, 1); assert.equal(refreshed, 2);
  await emit({ channel: "private-reviews-other", data: JSON.stringify({ name: "repository.index", data: {} }) });
  assert.equal(indexed, 0);
  await emit({ channel: "private-reviews-test", data: JSON.stringify({ name: "repository.index", data: { read: 15, total: 30 } }) });
  assert.equal(indexed, 1);
  await emit({ channel: "notifications", data: JSON.stringify({ name: "message.sent", data: { message: "Hello" } }) });
  assert.deepEqual(messages, ["Hello"]); assert.ok(states.includes("live"));
  await emit({ event: "subscription_error", channel: "private-reviews-test", data: "Subscription not authorized" });
  assert.ok(states.includes("unavailable"));
  stop(); assert.equal(socket.onmessage, null); assert.equal(socket.onclose, null); assert.equal(closed, 2);
});

test("an unconfigured instance never opens a hosted websocket", () => {
  let state = "";
  const stop = subscribeReviews({ channel: "private-reviews-test", organizationId: "org", onRefresh() {}, onMessage() {}, onState(value) { state = value; } }, () => { throw new Error("No network without configuration"); }, undefined, "");
  assert.equal(state, "unavailable"); stop();
});
