export type ChatFrame = { x: number; y: number; width: number; height: number };
export type Viewport = { width: number; height: number };
export const resizeDirections = ["n", "e", "s", "w", "ne", "se", "sw", "nw"] as const;
export type ResizeDirection = typeof resizeDirections[number];
export type WindowGesture = "move" | ResizeDirection;

const margin = 8;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function limits(viewport: Viewport) {
  const maxWidth = Math.max(1, viewport.width - margin * 2);
  const maxHeight = Math.max(1, viewport.height - margin * 2);
  return { maxWidth, maxHeight, minWidth: Math.min(360, maxWidth), minHeight: Math.min(420, maxHeight) };
}

export function fitChatFrame(frame: ChatFrame, viewport: Viewport): ChatFrame {
  const { minWidth, minHeight, maxWidth, maxHeight } = limits(viewport);
  const width = clamp(frame.width, minWidth, maxWidth);
  const height = clamp(frame.height, minHeight, maxHeight);
  return { width, height, x: clamp(frame.x, margin, viewport.width - margin - width), y: clamp(frame.y, margin, viewport.height - margin - height) };
}

export function adjustChatFrame(frame: ChatFrame, gesture: WindowGesture, dx: number, dy: number, viewport: Viewport): ChatFrame {
  const start = fitChatFrame(frame, viewport);
  if (gesture === "move") return fitChatFrame({ ...start, x: start.x + dx, y: start.y + dy }, viewport);
  const { minWidth, minHeight } = limits(viewport);
  let left = start.x, top = start.y, right = left + start.width, bottom = top + start.height;
  // Keep the opposite edge fixed when the dragged edge reaches its limit.
  if (gesture.includes("w")) left = clamp(left + dx, margin, right - minWidth);
  if (gesture.includes("e")) right = clamp(right + dx, left + minWidth, viewport.width - margin);
  if (gesture.includes("n")) top = clamp(top + dy, margin, bottom - minHeight);
  if (gesture.includes("s")) bottom = clamp(bottom + dy, top + minHeight, viewport.height - margin);
  return { x: left, y: top, width: right - left, height: bottom - top };
}
