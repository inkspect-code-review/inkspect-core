import assert from "node:assert/strict";
import test from "node:test";
import { compareFindings, loadFindings, parseFindingsQuery, type FindingRow } from "../../src/lib/findings";

const options = parseFindingsQuery(new URLSearchParams());
const target = (repositoryId: number) => ({ repositoryId, repository: `team/repo-${repositoryId}`, claims: { tenant: "workspace", subject: "member", connection: `connection-${repositoryId}`, installation: repositoryId + 100, repository: repositoryId } });
const finding = (id: number, repositoryId: number): FindingRow => ({ id: "F-1", jobId: `J-${id.toString(16).padStart(32, "0")}`, ordinal: 1, repositoryId, repository: `team/repo-${repositoryId}`, createdAt: "2026-10-30T12:00:00.123456Z", title: "Missing check", severity: "high", path: "src/api.ts", line: 1, advisory: false, pullNumber: 7 });

test("merges repository pages with stable cursors without dropping findings older than 40 reviews", async () => {
  const rows = Array.from({ length: 90 }, (_, i) => finding(i + 1, i % 3 + 1)).sort(compareFindings);
  const targets = [target(1), target(2), target(3)];
  const seen: FindingRow[] = [];
  let query = options;
  for (;;) {
    const result = await loadFindings(targets, query, async (target, query) => {
      const scoped = rows.filter(row => row.repositoryId === target.repositoryId);
      return { total: scoped.length, unavailableReports: 0, findings: scoped.filter(row => !query.cursor || compareFindings(row, query.cursor, query) > 0).slice(0, 26) };
    });
    assert.equal(result.total, 90);
    assert.ok(result.findings.length <= 25);
    seen.push(...result.findings);
    if (!result.nextCursor) break;
    query = parseFindingsQuery(new URLSearchParams({ cursor: result.nextCursor }));
  }
  assert.deepEqual(seen, rows);
});

test("partial repository failures are disclosed and total failure is not an empty result", async () => {
  const result = await loadFindings([target(1), target(2)], options, async target => {
    if (target.repositoryId === 2) throw new Error("Unavailable");
    return { findings: [finding(1, 1)], total: 1, unavailableReports: 2 };
  });
  assert.equal(result.unavailableRepositories, 1);
  assert.equal(result.unavailableReports, 2);
  assert.equal(result.total, 1);
  await assert.rejects(loadFindings([target(1)], options, async () => { throw new Error("Offline"); }), /temporarily unavailable/);
});

test("query validation rejects malformed filters and preserves literal search and precise cursors", () => {
  const valid = parseFindingsQuery(new URLSearchParams({ query: "  src/a_%  ", severity: "critical", from: "2026-10-24T23:00:00.000Z", before: "2026-10-26T00:00:00.000Z" }));
  assert.equal(valid.query, "src/a_%");
  const invalid: Record<string, string>[] = [{ severity: "p9" }, { sort: "title" }, { direction: "desc; DROP TABLE jobs" }, { from: "2026-02-30T00:00:00.000Z" }, { before: "bad" }, { from: "2026-10-31T00:00:00.000Z", before: "2026-10-30T00:00:00.000Z" }, { cursor: "bad" }, { query: "a".repeat(301) }];
  for (const params of invalid) assert.throws(() => parseFindingsQuery(new URLSearchParams(params)));
});


test("severity sorting uses importance rather than alphabetical order, with deterministic date ties", () => {
  const rows = ["low", "critical", "medium", "high"].map((severity, i) => ({ ...finding(i + 1, 1), severity }));
  assert.deepEqual([...rows].sort((a, b) => compareFindings(a, b, { sort: "severity", direction: "desc" })).map(row => row.severity), ["critical", "high", "medium", "low"]);
  assert.deepEqual([...rows].sort((a, b) => compareFindings(a, b, { sort: "severity", direction: "asc" })).map(row => row.severity), ["low", "medium", "high", "critical"]);
});
