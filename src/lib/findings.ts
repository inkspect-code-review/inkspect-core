import type { EngineClaims } from "./engine-client";
import { ReviewError } from "./review-access";
import { captureError } from "./diagnostics/server";
import { readRepositoryFindings } from "./findings-store";
import type { FindingStatus, FindingStatusInfo } from "./finding-status";

export const findingsPageSize = 25;
export type FindingRow = {
  id: string; jobId: string; repositoryId: number; repository: string; ordinal: number;
  title: string; severity: string; path: string; line: number; advisory: boolean;
  pullNumber: number | null; createdAt: string;
  resolution?: FindingStatusInfo;
};
export type FindingsOrder = { sort: "date" | "severity"; direction: "asc" | "desc" };
export type FindingCursor = Pick<FindingRow, "createdAt" | "jobId" | "ordinal" | "repositoryId" | "severity"> & FindingsOrder;
export type FindingsQuery = FindingsOrder & { query: string; severity: string; status: FindingStatus | "all"; from: string | null; before: string | null; cursor: FindingCursor | null };
export type FindingsResponse = {
  findings: FindingRow[]; total: number; pageSize: number; nextCursor: string | null;
  unavailableRepositories: number; unavailableReports: number;
};
export type FindingsTarget = { repositoryId: number; repository: string; claims: Omit<EngineClaims, "expires"> };
export type RepositoryFindings = { findings: FindingRow[]; total: number; unavailableReports: number };

export function parseFindingsQuery(params: URLSearchParams): FindingsQuery {
  const query = (params.get("query") || "").trim();
  const severity = params.get("severity") || "all";
  const status = params.get("status") || "all";
  const sort = params.get("sort") || "date";
  const direction = params.get("direction") || "desc";
  if (sort !== "date" && sort !== "severity") throw new ReviewError(400, "Choose a valid sort column.");
  if (direction !== "asc" && direction !== "desc") throw new ReviewError(400, "Choose a valid sort direction.");
  if (query.length > 300) throw new ReviewError(400, "Keep your search under 300 characters.");
  if (!["all", "critical", "high", "medium", "low"].includes(severity)) throw new ReviewError(400, "Choose a valid severity.");
  if (!["all", "open", "not_detected", "resolved", "historical"].includes(status)) throw new ReviewError(400, "Choose a valid finding status.");
  const timestamp = (key: string) => {
    const value = params.get(key);
    if (!value) return null;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new ReviewError(400, "Choose a valid date range.");
    return value;
  };
  const from = timestamp("from"), before = timestamp("before");
  if (from && before && from >= before) throw new ReviewError(400, "Start date must be on or before the end date.");
  let cursor: FindingCursor | null = null;
  const encoded = params.get("cursor");
  if (encoded) {
    try {
      if (encoded.length > 600 || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error();
      const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
      if (typeof value.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt)) || !/^J-[a-f0-9]{32}$/.test(value.jobId) || !Number.isSafeInteger(value.ordinal) || value.ordinal < 1 || !Number.isSafeInteger(value.repositoryId) || value.repositoryId < 1) throw new Error();
      if (value.sort !== sort || value.direction !== direction || !["critical", "high", "medium", "low"].includes(value.severity)) throw new Error();
      cursor = { createdAt: value.createdAt, jobId: value.jobId, ordinal: value.ordinal, repositoryId: value.repositoryId, severity: value.severity, sort, direction };
    } catch { throw new ReviewError(400, "Invalid findings page. Refresh and try again."); }
  }
  return { query, severity, status: status as FindingsQuery["status"], from, before, cursor, sort, direction };
}

// Keep PostgreSQL's microsecond timestamps and a deterministic tie-breaker.
const severityRanks: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
export function compareFindings(a: Pick<FindingRow, "createdAt" | "jobId" | "ordinal" | "repositoryId" | "severity">, b: typeof a, order: FindingsOrder = { sort: "date", direction: "desc" }) {
  const date = a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
  const severity = severityRanks[b.severity] - severityRanks[a.severity];
  return (order.sort === "severity" ? severity * (order.direction === "asc" ? -1 : 1) : 0)
    || date * (order.sort === "date" && order.direction === "asc" ? -1 : 1)
    || (a.jobId < b.jobId ? 1 : a.jobId > b.jobId ? -1 : 0)
    || a.ordinal - b.ordinal || b.repositoryId - a.repositoryId;
}

export async function loadFindings(targets: FindingsTarget[], options: FindingsQuery, read = readRepositoryFindings): Promise<FindingsResponse> {
  const rows: FindingRow[] = [];
  let total = 0, unavailableRepositories = 0, unavailableReports = 0;
  for (let start = 0; start < targets.length; start += 4) {
    const results = await Promise.allSettled(targets.slice(start, start + 4).map(target => read(target, options)));
    for (const [index, result] of results.entries()) {
      if (result.status === "fulfilled") {
        rows.push(...result.value.findings); total += result.value.total; unavailableReports += result.value.unavailableReports;
      } else {
        unavailableRepositories++;
        captureError("review.findings", result.reason, { repositoryId: targets[start + index].repositoryId });
      }
    }
  }
  if (targets.length && unavailableRepositories === targets.length) throw new ReviewError(503, "Findings are temporarily unavailable. Please try again.");
  const sorted = rows.sort((a, b) => compareFindings(a, b, options)), findings = sorted.slice(0, findingsPageSize);
  const last = findings.at(-1);
  const nextCursor = sorted.length > findingsPageSize && last ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, jobId: last.jobId, ordinal: last.ordinal, repositoryId: last.repositoryId, severity: last.severity, sort: options.sort, direction: options.direction })).toString("base64url") : null;
  return { findings, total, pageSize: findingsPageSize, nextCursor, unavailableRepositories, unavailableReports };
}
