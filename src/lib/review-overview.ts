import type { ReportResponse, ReviewJob, ReviewReport } from "./review-types";
import type { FindingStatusSummary } from "./finding-status";

export const overviewSeverities = ["critical", "high", "medium", "low"] as const;
export type OverviewSeverity = typeof overviewSeverities[number];
export type OverviewDecision = ReviewReport["decision"];
// 53 Monday-first weeks (a GitHub-style year) fit whatever weekday today is.
export const overviewDays = 371;

export type ReportDigest = { decision: OverviewDecision; severities: Record<OverviewSeverity, number> };
export type OverviewRepositoryJobs = { repositoryId: number; fullName: string; reviews: ReviewJob[] };
export type OverviewReview = {
  id: string; repositoryId: number; repository: string; number: number | null; url: string; title?: string;
  status: string; createdAt: string; decision: OverviewDecision | null; findings: number | null;
  severities: Record<OverviewSeverity, number> | null;
  findingStates?: { resolved: number; notDetected: number; historical: number };
};
export type ReviewOverview = {
  asOf: string;
  totals: { reviews: number; completed: number; failed: number; active: number; findings: number; repositories: number };
  severities: Record<OverviewSeverity, number>;
  decisions: Record<OverviewDecision, number>;
  // One UTC day per entry, oldest first, ending on asOf's day.
  daily: { date: string; completed: number; failed: number }[];
  recent: OverviewReview[];
  // The newest completed saved review.
  latest: OverviewReview | null;
  // Repositories whose review history could not be read; totals exclude them.
  unavailable: number;
  // Retained for older clients; saved reviews do not need live PR verification.
  unverified: number;
  // Completed reviews whose report could not be read; severity totals exclude them.
  unreported: number;
  findingStatus?: FindingStatusSummary;
  findingStatusUnavailable?: boolean;
};

// The engine reports P0–P3; older reports may use words.
const severityAliases: Record<string, OverviewSeverity> = {
  p0: "critical", critical: "critical", p1: "high", high: "high", p2: "medium", medium: "medium", p3: "low", low: "low",
};
export const overviewSeverity = (value: string): OverviewSeverity => severityAliases[value.trim().toLowerCase()] ?? "low";

export function digestReport(report: ReportResponse["report"]): ReportDigest {
  const severities = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of report.findings ?? []) severities[overviewSeverity(String(finding.severity ?? ""))]++;
  return { decision: report.decision, severities };
}

const pullNumber = (url: string) => {
  const match = /\/pull\/(\d+)(?:[/?#]|$)/.exec(url);
  return match ? Number(match[1]) : null;
};
const day = (date: Date) => date.toISOString().slice(0, 10);
const terminalFailure = (status: string) => status === "failed" || status === "cancelled";

export function buildOverview(lists: OverviewRepositoryJobs[], digests: Map<string, ReportDigest>, options: { now: Date; unavailable: number; recent?: number }): ReviewOverview {
  const severities = { critical: 0, high: 0, medium: 0, low: 0 };
  const decisions = { needs_changes: 0, needs_evidence: 0, ready_for_human: 0, ready_for_review: 0 };
  const end = new Date(Date.UTC(options.now.getUTCFullYear(), options.now.getUTCMonth(), options.now.getUTCDate()));
  const daily = Array.from({ length: overviewDays }, (_, index) => ({ date: day(new Date(end.getTime() - (overviewDays - 1 - index) * 86_400_000)), completed: 0, failed: 0 }));
  const position = new Map(daily.map((entry, index) => [entry.date, index]));
  const totals = { reviews: 0, completed: 0, failed: 0, active: 0, findings: 0, repositories: 0 };
  const rows: OverviewReview[] = [];
  let unreported = 0;
  for (const list of lists) {
    const reviews = [...new Map(list.reviews.map((review) => [review.job.id, review])).values()];
    if (reviews.some((review) => review.job.status === "completed")) totals.repositories++;
    for (const review of reviews) {
      const { status, created_at: createdAt } = review.job;
      totals.reviews++;
      const digest = status === "completed" ? digests.get(review.job.id) : undefined;
      if (status === "completed") {
        totals.completed++;
        if (digest) {
          decisions[digest.decision] = (decisions[digest.decision] ?? 0) + 1;
          for (const severity of overviewSeverities) { severities[severity] += digest.severities[severity]; totals.findings += digest.severities[severity]; }
        } else unreported++;
      } else if (terminalFailure(status)) totals.failed++;
      else totals.active++;
      const bucket = Number.isNaN(Date.parse(createdAt)) ? undefined : position.get(day(new Date(createdAt)));
      if (bucket !== undefined && status === "completed") daily[bucket].completed++;
      if (bucket !== undefined && terminalFailure(status)) daily[bucket].failed++;
      // Saved reviews remain visible regardless of current GitHub PR state.
      const number = pullNumber(review.snapshot?.url ?? "");
      rows.push({
        id: review.job.id, repositoryId: list.repositoryId, repository: list.fullName, number,
        url: review.snapshot?.url ?? "", title: review.snapshot?.title?.trim() || undefined, status, createdAt, decision: digest?.decision ?? null,
        findings: digest ? overviewSeverities.reduce((sum, severity) => sum + digest.severities[severity], 0) : null,
        severities: digest ? { ...digest.severities } : null,
      });
    }
  }
  rows.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id));
  const latest = rows.find((row) => row.status === "completed") ?? null;
  return { asOf: options.now.toISOString(), totals, severities, decisions, daily, recent: rows.slice(0, options.recent ?? 6), latest, unavailable: options.unavailable, unverified: 0, unreported };
}

// Completed reports are immutable, so their small digests can be reused
// across dashboard loads. Keys include the tenant to keep workspaces apart.
const digestCache = new Map<string, ReportDigest>();
export const cachedDigest = (tenant: string, jobId: string) => digestCache.get(`${tenant}:${jobId}`);
export function rememberDigest(tenant: string, jobId: string, digest: ReportDigest) {
  if (digestCache.size >= 5_000) digestCache.delete(digestCache.keys().next().value!);
  digestCache.set(`${tenant}:${jobId}`, digest);
}
