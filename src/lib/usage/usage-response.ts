import type { UsageEntry, UsageGroup, UsageHistory } from "./usage-display";

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const integerString = (value: unknown) => typeof value === "string" && /^-?\d+$/.test(value);

// A successful HTTP response can still come from an older API bundle. Never
// treat a page of raw receipts as a page of aggregated groups: its totals and
// drill-down identifiers would be wrong, even if we filled in missing fields.
export function assertUsageHistoryResponse(value: unknown, grouped: boolean): asserts value is UsageHistory<UsageEntry | UsageGroup> {
  const valid = object(value)
    && value.group_by === (grouped ? "day" : "none")
    && typeof value.has_more === "boolean"
    && Array.isArray(value.totals)
    && value.totals.every(total => object(total) && typeof total.category === "string" && integerString(total.amount))
    // Older grouped API responses remain usable while the chart rolls out.
    // Never fabricate a chart from the current page of table rows.
    && (!grouped || value.daily === undefined || (Array.isArray(value.daily) && value.daily.every(day => object(day)
      && typeof day.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day.day)
      && [day.input_tokens, day.output_tokens].every(tokens => tokens === null || (typeof tokens === "string" && /^\d+$/.test(tokens) && Number.isFinite(Number(tokens)))))))
    && Array.isArray(value.records)
    && value.records.every(row => object(row) && typeof row.id === "string" && (grouped
      ? typeof row.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.day) && Array.isArray(row.statuses) && row.statuses.every(status => typeof status === "string")
      : typeof row.status === "string" && typeof row.started_at === "string"));
  if (!valid) throw new Error("Usage is temporarily unavailable. Please refresh and try again.");
}
