export type UsageEntry = {
  id: string; category: string; operation_id: string; user_id: string | null;
  repository_id: string | null; repository_name: string | null; provider: string | null;
  model: string | null; status: string; input_tokens: string | null;
  output_tokens: string | null; cached_input_tokens: string | null; cache_write_input_tokens?: string | null; total_tokens: string | null;
  calls: number | null; units: string | null; duration_ms: string | null; amount: string | null;
  started_at: string; finished_at: string | null;
};
export type UsageGroup = Omit<UsageEntry, "operation_id" | "status" | "finished_at" | "calls"> & {
  day: string; latest_at: string; operations: number; statuses: string[]; calls: string | null;
  unmeasured: number; in_progress: number; missing_input_tokens: number; missing_output_tokens: number;
};
export type UsageTotal = { category: string; operations: number; paused: number; unmeasured: number; amount: string; input_tokens: string; output_tokens: string; total_tokens: string };
export type UsageDay = { day: string; input_tokens: string | null; output_tokens: string | null };
export type UsageHistory<T> = { totals: UsageTotal[]; records: T[]; daily?: UsageDay[]; has_more: boolean };

// Review and indexing rows cover a single repository; chat spans repositories.
export function usageRepository(
  entry: Pick<UsageGroup, "category" | "repository_name" | "repository_id">,
) {
  if (entry.category !== "review" && entry.category !== "embedding") return null;
  return entry.repository_name || entry.repository_id || "Workspace";
}

export const usageNumber = (value: string | number | null) => value === null ? "—" : new Intl.NumberFormat("en-US").format(Number(value));
export const usageCategoryLabel = (category: string) => category === "embedding" ? "Indexing" : category[0].toUpperCase() + category.slice(1);
export type UsagePresentation = {
  amountLabel: string;
  totalLabel: string;
  formatAmount: (amount: string) => string;
  note: string;
  read: (value: unknown, grouped: boolean) => UsageHistory<UsageEntry | UsageGroup>;
};
