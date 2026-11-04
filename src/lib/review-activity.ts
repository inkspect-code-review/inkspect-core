export type ReviewActivityEvent = {
  sequence: number;
  created_at: string;
  event: { kind: string; operation?: string; path?: string; call?: number; code?: string; duration_ms?: number; input_tokens?: number; cached_input_tokens?: number; output_tokens?: number };
};
const labels: Record<string, string> = {
 "source.snapshot.started": "Downloading pinned repository snapshot", "source.snapshot.completed": "Repository snapshot ready", "source.snapshot.fallback": "Using bounded file reads for this snapshot",
  "review.paused": "Paused while waiting for credit", "review.resumed": "Review resumed", "review.started": "Review started", "review.completed": "Report ready", "review.failed": "Review failed", "review.cancelled": "Review cancelled",
  "source.started": "Collecting repository context", "source.completed": "Repository context ready",
  "model.started": "Starting Codex", "model.turn_started": "Codex is working", "model.response_received": "Codex response received", "model.completed": "Codex response validated", "model.failed": "Codex call failed",
  "report.started": "Validating findings and preparing the report", "report.validation": "Checking findings against evidence", "report.diagram": "Building the review diagram", "report.persist": "Saving the report", "activity.truncated": "Activity history reached its limit; the final result will still be recorded",
};
const operations: Record<string, string> = { resolve: "Resolve revision", list: "List repository files", read: "Read file", diff: "Compare changed files", search: "Find related code" };
export function activityLabel(row: ReviewActivityEvent) {
  const e = row.event;
  if (e.kind.startsWith("source.operation.")) return `${operations[e.operation || ""] || "Read repository"}${e.kind.endsWith(".completed") ? " · done" : e.kind.endsWith(".failed") ? " · unavailable" : ""}`;
  return `${labels[e.kind] || "Review activity"}${e.call ? ` · call ${e.call}` : ""}`;
}
export function mergeActivity(current: ReviewActivityEvent[], incoming: ReviewActivityEvent[]) {
  const rows = new Map(current.map((row) => [row.sequence, row]));
  for (const row of incoming) if (Number.isSafeInteger(row.sequence) && row.sequence > 0 && row.sequence <= 2003 && typeof row.event?.kind === "string") rows.set(row.sequence, row);
  return [...rows.values()].sort((a, b) => a.sequence - b.sequence);
}
