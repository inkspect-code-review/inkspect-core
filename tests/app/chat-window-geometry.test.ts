import assert from "node:assert/strict";
import { test } from "node:test";
import { adjustChatFrame, fitChatFrame, resizeDirections } from "../../src/lib/chat-window-geometry";

const viewport = { width: 1440, height: 1000 };
const frame = { x: 400, y: 200, width: 480, height: 690 };

test("dragging keeps the entire chat inside the viewport without changing its size", () => {
  assert.deepEqual(adjustChatFrame(frame, "move", -2000, -2000, viewport), { ...frame, x: 8, y: 8 });
  assert.deepEqual(adjustChatFrame(frame, "move", 2000, 2000, viewport), { ...frame, x: 952, y: 302 });
});

test("resizing from the top left preserves the opposite corner at minimum size", () => {
  const result = adjustChatFrame(frame, "nw", 2000, 2000, viewport);
  assert.deepEqual(result, { x: 520, y: 470, width: 360, height: 420 });
  assert.equal(result.x + result.width, frame.x + frame.width);
  assert.equal(result.y + result.height, frame.y + frame.height);
});

test("all edges and corners remain within screen bounds for large pointer movements", () => {
  for (const direction of resizeDirections) {
    for (const dx of [-2000, 2000]) for (const dy of [-2000, 2000]) {
      const result = adjustChatFrame(frame, direction, dx, dy, viewport);
      assert.ok(result.x >= 8 && result.y >= 8);
      assert.ok(result.x + result.width <= viewport.width - 8);
      assert.ok(result.y + result.height <= viewport.height - 8);
      assert.ok(result.width >= 360 && result.height >= 420);
      if (!direction.includes("w")) assert.equal(result.x, frame.x);
      if (!direction.includes("n")) assert.equal(result.y, frame.y);
      if (!direction.includes("e")) assert.equal(result.x + result.width, frame.x + frame.width);
      if (!direction.includes("s")) assert.equal(result.y + result.height, frame.y + frame.height);
    }
  }
});

test("saved positions fit a smaller screen, even below the normal minimum size", () => {
  const result = fitChatFrame(frame, { width: 320, height: 350 });
  assert.deepEqual(result, { x: 8, y: 8, width: 304, height: 334 });
  assert.deepEqual(fitChatFrame(result, { width: 320, height: 350 }), result);
});
