export type FindingStatus = "open" | "not_detected" | "resolved" | "historical";
export type FindingStatusInfo = {
  status: FindingStatus; source: "latest_review" | "verified_fix" | "manual" | "earlier_review";
  reviewId?: string; commit?: string; at?: string;
};
export type FindingStatusSummary = { open: number; resolved: number; notDetected: number; historical: number; manualResolved: number; verifiedResolved: number; severities: Record<"critical" | "high" | "medium" | "low", number> };
export type FindingReviewRecord = {
  id: string; status: string; createdAt: string; url: string; head: string; base: string;
  valid: boolean; coverageComplete: boolean; excludedFiles: number; blockingGaps: boolean;
  findings: { id: string; severity: string }[];
  fixOf?: string | null; fixCommit?: string | null;
  verification?: { status?: string; version?: number; attempts?: number; findings?: number; candidate_sha256?: string } | null;
};
export type ManualFindingResolution = { jobId: string; ordinal: number; findingId: string; resolvedAt: string };
export type FindingLifecycle = { records: FindingReviewRecord[]; statuses: Record<string, FindingStatusInfo[]>; latestIds: string[]; summary: FindingStatusSummary; unreported: number };

export const findingStatusLabels: Record<FindingStatus, string> = { open: "Open", not_detected: "Not detected in latest review", resolved: "Resolved", historical: "Earlier review" };
const prKey = (row: FindingReviewRecord) => row.url.match(/\/pull\/([1-9]\d*)(?:[/?#]|$)/)?.[1] ?? `review:${row.id}`;
const timestamp = (row: FindingReviewRecord) => {
  const value = new Date(row.createdAt);
  if (Number.isNaN(value.getTime())) return "";
  const fraction = row.createdAt.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1] ?? "";
  // Preserve PostgreSQL microseconds; Date alone collapses runs in the same ms.
  return `${value.toISOString().slice(0, 19)}.${fraction.padEnd(6, "0").slice(0, 6)}Z`;
};
const aliases: Record<string, keyof FindingStatusSummary["severities"]> = { p0: "critical", p1: "high", p2: "medium", p3: "low", critical: "critical", high: "high", medium: "medium", low: "low" };
const severity = (value: string) => aliases[value.trim().toLowerCase()] ?? "low";

// Absence in another report is not proof of repair. Only a committed,
// independently verified fix or an explicit manual resolution means Resolved.
export function buildFindingLifecycle(records: FindingReviewRecord[], manual: ManualFindingResolution[] = []): FindingLifecycle {
  const reviews = records.filter(row => row.status === "completed" && row.valid && !row.fixOf);
  const byId = new Map(reviews.map(row => [row.id, row]));
  const latest = new Map<string, FindingReviewRecord>();
  for (const row of reviews) {
    const known = latest.get(prKey(row));
    if (!known || timestamp(row) > timestamp(known) || (timestamp(row) === timestamp(known) && row.id > known.id)) latest.set(prKey(row), row);
  }
  const verified = new Map<string, FindingStatusInfo>();
  for (const current of latest.values()) {
    const validFix = (row: FindingReviewRecord, source: FindingReviewRecord | undefined) => {
      const v = row.verification;
      return row.status === "completed" && source && source.head === row.head && /^[a-f0-9]{40}$/.test(row.fixCommit ?? "")
        && source.base === current.base && source.base !== "" && prKey(source) === prKey(current) && timestamp(row) >= timestamp(source)
        && v?.status === "passed" && [2, 3].includes(v.version ?? 0) && Number.isInteger(v.attempts) && v.attempts! >= 1 && v.attempts! <= 3
        && /^[a-f0-9]{64}$/.test(v.candidate_sha256 ?? "") && source.findings.length > 0 && v.findings === source.findings.length;
    };
    const committed = records.filter(row => row.fixOf === current.id && validFix(row, current)).sort((a, b) => timestamp(b).localeCompare(timestamp(a)))[0];
    if (committed) verified.set(current.id, { status: "resolved", source: "verified_fix", reviewId: current.id, commit: committed.fixCommit!, at: committed.createdAt });
    let head = current.head;
    const seen = new Set<string>();
    while (/^[a-f0-9]{40}$/.test(head) && !seen.has(head)) {
      seen.add(head);
      const fix = records.find(row => {
        const source = row.fixOf ? byId.get(row.fixOf) : undefined;
        return row.fixCommit === head && validFix(row, source) && timestamp(row) <= timestamp(current);
      });
      if (!fix?.fixOf) break;
      verified.set(fix.fixOf, { status: "resolved", source: "verified_fix", reviewId: current.id, commit: fix.fixCommit!, at: fix.createdAt });
      head = fix.head;
    }
  }
  const overrides = new Map(manual.map(row => [`${row.jobId}:${row.ordinal}`, row]));
  const statuses: FindingLifecycle["statuses"] = {};
  const summary: FindingStatusSummary = { open: 0, resolved: 0, notDetected: 0, historical: 0, manualResolved: 0, verifiedResolved: 0, severities: { critical: 0, high: 0, medium: 0, low: 0 } };
  for (const row of reviews) {
    const current = latest.get(prKey(row))!;
    const clean = current.findings.length === 0 && current.coverageComplete && current.excludedFiles === 0 && !current.blockingGaps
      && current.base !== "" && current.base === row.base;
    const automatic: FindingStatusInfo = verified.get(row.id) ?? (current.id === row.id ? { status: "open", source: "latest_review" }
      : { status: clean ? "not_detected" : "historical", source: clean ? "latest_review" : "earlier_review", reviewId: current.id, commit: current.head, at: current.createdAt });
    statuses[row.id] = row.findings.map((finding, index) => {
      const override = overrides.get(`${row.id}:${index + 1}`);
      const info: FindingStatusInfo = override?.findingId === finding.id ? { status: "resolved", source: "manual", at: override.resolvedAt } : { ...automatic };
      if (info.status === "open") { summary.open++; summary.severities[severity(finding.severity)]++; }
      if (info.status === "resolved") { summary.resolved++; if (info.source === "manual") summary.manualResolved++; else summary.verifiedResolved++; }
      if (info.status === "not_detected") summary.notDetected++;
      if (info.status === "historical") summary.historical++;
      return info;
    });
  }
  const newest = new Map<string, FindingReviewRecord>();
  for (const row of records.filter(row => row.status === "completed" && !row.fixOf)) {
    const known = newest.get(prKey(row));
    if (!known || timestamp(row) > timestamp(known) || (timestamp(row) === timestamp(known) && row.id > known.id)) newest.set(prKey(row), row);
  }
  return { records, statuses, latestIds: [...latest.values()].map(row => row.id), summary, unreported: [...newest.values()].filter(row => !row.valid).length };
}
