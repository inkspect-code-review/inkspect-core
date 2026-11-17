import { engineRoutes, runtimeEngineOrigin } from "./engine-routing";
import { captureError } from "./diagnostics/server";
import type { ReviewLifecycle, ReviewProviderState } from "./review-lifecycle";
import { reviewChannel } from "./realtime";
import type { Auth } from "./github";
import { engineRequest } from "./engine-client";
import { readReviewJSON, reviewAccess, ReviewError, reviewFailure, reviewJSON } from "./review-access";
import type { Repository } from "./github";
import type { ReportResponse, ReviewJob, ReviewRepository } from "./review-types";
import { buildOverview, cachedDigest, digestReport, rememberDigest, type OverviewRepositoryJobs, type ReportDigest } from "./review-overview";
import { storedReviewModels } from "./review-models";
import { newestReviews, reviewsWithFindingSummaries } from "./review-history";
import { loadFindings, parseFindingsQuery } from "./findings";
import { storedReviewRepositories } from "./review-repositories";
import { findingStatusStore } from "./finding-status-store";
import type { FindingStatusSummary } from "./finding-status";

export async function handleReviews(request: Request, auth: Auth, send = engineRequest, lifecycle: ReviewLifecycle, models = storedReviewModels, providerState: ReviewProviderState, findings = loadFindings, storedRepositories = storedReviewRepositories, statuses = findingStatusStore) {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get("action") || "repositories";
    // A new workspace has an empty overview before GitHub is connected.
    const access = await reviewAccess(request, auth, { allowUnconnected: request.method === "GET" && action === "overview" });
    const repository = Number(url.searchParams.get("repositoryId") || 0);
    if (!Number.isSafeInteger(repository) || (!["repositories", "overview", "history", "findings"].includes(action) && repository < 1)) throw new ReviewError(400, "Choose a repository.");
    const connectionClaims = (connection: typeof access.connections[number], repositoryId: number) => {
      const installation = Number(connection.installationId);
      if (!Number.isSafeInteger(installation) || installation < 1) throw new ReviewError(400, "Invalid GitHub installation.");
      return { tenant: access.organizationId, subject: access.userId, connection: connection.id, installation, repository: repositoryId };
    };
    const activeTargets = [...new Map(access.connections.flatMap(connection => (JSON.parse(connection.repositories) as Repository[])
      .map(repo => [repo.id, { connection, repo }] as const))).values()];
    let savedTargets: Promise<typeof activeTargets> | undefined;
    const historyTargets = () => savedTargets ??= (async () => {
      if (!access.connections.length) return activeTargets;
      const archived = await storedRepositories(access.organizationId, access.userId);
      const targets = new Map(activeTargets.map(target => [target.repo.id, target]));
      for (const row of archived) {
        const id = Number(row.repositoryId);
        const connection = access.connections.find(c => c.id === row.connectionId && c.installationId === row.installationId);
        if (connection && Number.isSafeInteger(id) && id > 0 && !targets.has(id)) {
          targets.set(id, { connection, repo: { id, fullName: row.fullName, private: true } });
        }
      }
      return [...targets.values()];
    })();
    const withFindingSummaries = async (rows: ReviewJob[], target: typeof activeTargets[number]) => {
      if (!rows.some(row => row.job.status === "completed")) return rows;
      try {
        return reviewsWithFindingSummaries(rows, await statuses.read({ repositoryId: target.repo.id, repository: target.repo.fullName, claims: connectionClaims(target.connection, target.repo.id) }));
      } catch (error) {
        captureError("review.history.finding_status", error, { repositoryId: target.repo.id });
        return rows;
      }
    };
    if (request.method === "POST" && action === "finding-status") {
      const target = (await historyTargets()).find(target => target.repo.id === repository);
      if (!target) throw new ReviewError(403, "This repository has no saved review access in this workspace.");
      const jobId = url.searchParams.get("jobId");
      if (!jobId || !/^J-[a-f0-9]{32}$/.test(jobId)) throw new ReviewError(400, "Invalid review ID.");
      const body = await readReviewJSON(request);
      if (Object.keys(body).some(key => !["ordinal", "findingId", "resolved"].includes(key)) || !Number.isSafeInteger(body.ordinal) || Number(body.ordinal) < 1
        || typeof body.findingId !== "string" || !body.findingId.length || body.findingId.length > 200 || typeof body.resolved !== "boolean") throw new ReviewError(400, "Choose a finding and resolution.");
      const resolution = await statuses.resolve({ repositoryId: repository, repository: target.repo.fullName, claims: connectionClaims(target.connection, repository) }, { jobId, ordinal: Number(body.ordinal), findingId: body.findingId, resolved: body.resolved });
      return reviewJSON({ resolution });
    }
    if (request.method === "GET" && action === "repositories" && url.searchParams.get("verify") !== "1") {
      // Installation metadata was verified when connected/refreshed. Showing
      // names is not an authorization grant: the selected worker revalidates
      // stored job scope locally and live GitHub access for PRs and admission.
      const repositories = access.connections.flatMap(connection => (JSON.parse(connection.repositories) as Repository[])
        .map(repo => ({ id: repo.id, full_name: repo.fullName, private: repo.private })));
      const activeIds = new Set(activeTargets.map(target => target.repo.id));
      const historyRepositories = (await historyTargets()).map(({ repo }) => ({ id: repo.id, full_name: repo.fullName, private: repo.private, archived: !activeIds.has(repo.id) }));
      return reviewJSON({ repositories: [...new Map(repositories.map(repo => [repo.id, repo])).values()], history_repositories: historyRepositories, realtime_channel: reviewChannel(access.organizationId) });
    }
    if (request.method === "GET" && action === "findings") {
      const targets = (await historyTargets()).map(({ connection, repo }) => ({ repositoryId: repo.id, repository: repo.fullName, claims: connectionClaims(connection, repo.id) }));
      if (repository < 0) throw new ReviewError(400, "Invalid repository.");
      if (repository && !targets.some(target => target.repositoryId === repository)) throw new ReviewError(403, "This repository is not connected to this workspace.");
      return reviewJSON(await findings(repository ? targets.filter(target => target.repositoryId === repository) : targets, parseFindingsQuery(url.searchParams)));
    }
    if (request.method === "GET" && action === "history") {
      const targets = await historyTargets();
      const rows: ReviewJob[] = [];
      let unavailable = 0;
      // Load compact finding lifecycle summaries from stored records, without
      // fetching individual reports or contacting GitHub.
      for (let start = 0; start < targets.length; start += 4) {
        const outcomes = await Promise.allSettled(targets.slice(start, start + 4).map(async ({ connection, repo }) => {
          const result = await send("/jobs", "GET", undefined, connectionClaims(connection, repo.id));
          await lifecycle.settle(access.organizationId, result);
          return withFindingSummaries((Array.isArray(result.reviews) ? result.reviews : []).filter((row: ReviewJob) => row.snapshot.repository_id === String(repo.id)), { connection, repo });
        }));
        for (const outcome of outcomes) {
          if (outcome.status === "fulfilled") rows.push(...outcome.value);
          else unavailable++;
        }
      }
      if (targets.length && unavailable === targets.length) throw new ReviewError(503, "Review history is temporarily unavailable. Please try again.");
      return reviewJSON({ reviews: newestReviews(rows), unavailable_repositories: unavailable });
    }
    if (request.method === "GET" && action === "models") {
      const connection = access.connections.find(candidate => (JSON.parse(candidate.repositories) as Repository[]).some(repo => repo.id === repository));
      if (!connection) throw new ReviewError(403, "This repository is not connected to this workspace.");
      return reviewJSON(await models(connectionClaims(connection, repository)));
    }
    if (request.method === "GET" && action === "overview") {
      // Workspace-wide review history for the dashboard. Every repository is
      // read with its own claims, so the engine still checks stored job access.
      const targets = (await historyTargets()).slice(0, 50);
      const lists: (OverviewRepositoryJobs & { claims: ReturnType<typeof connectionClaims> })[] = [];
      let unavailable = 0;
      for (let start = 0; start < targets.length; start += 4) {
        const outcomes = await Promise.allSettled(targets.slice(start, start + 4).map(async ({ connection, repo }) => {
          const claims = connectionClaims(connection, repo.id);
          const result = await send("/jobs", "GET", undefined, claims) as { reviews?: ReviewJob[] };
          const reviews = Array.isArray(result.reviews) ? result.reviews : [];
          return { repositoryId: repo.id, fullName: repo.fullName, claims, reviews };
        }));
        for (const [index, outcome] of outcomes.entries()) {
          if (outcome.status === "fulfilled") { lists.push(outcome.value); continue; }
          unavailable++;
          if (!(outcome.reason instanceof ReviewError)) captureError("review.overview", outcome.reason, { repositoryId: targets[start + index].repo.id });
        }
      }
      if (targets.length && unavailable === targets.length) throw new ReviewError(503, "Review history is temporarily unavailable. Please try again.");
      const digests = new Map<string, ReportDigest>();
      const missing = lists.flatMap(list => list.reviews.filter(review => review.job.status === "completed").map(review => ({ id: review.job.id, createdAt: review.job.created_at, claims: list.claims })))
        .filter(({ id }) => { const known = cachedDigest(access.organizationId, id); if (known) digests.set(id, known); return !known && /^J-[a-f0-9]{32}$/.test(id); })
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 40);
      for (let start = 0; start < missing.length; start += 4) {
        await Promise.allSettled(missing.slice(start, start + 4).map(async ({ id, claims }) => {
          const digest = digestReport((await send(`/jobs/${id}/report`, "GET", undefined, claims) as ReportResponse).report);
          rememberDigest(access.organizationId, id, digest); digests.set(id, digest);
        }));
      }
      const overview = buildOverview(lists, digests, { now: new Date(), unavailable });
      const findingStatus: FindingStatusSummary = { open: 0, resolved: 0, notDetected: 0, historical: 0, manualResolved: 0, verifiedResolved: 0, severities: { critical: 0, high: 0, medium: 0, low: 0 } };
      let lifecycleUnavailable = false;
      for (let start = 0; start < lists.length; start += 4) {
        const results = await Promise.allSettled(lists.slice(start, start + 4).map(async list => ({ list, lifecycle: await statuses.read({ repositoryId: list.repositoryId, repository: list.fullName, claims: list.claims }) })));
        for (const result of results) {
          if (result.status === "rejected") { lifecycleUnavailable = true; captureError("review.finding_status", result.reason); continue; }
          const { list, lifecycle } = result.value;
          if (lifecycle.unreported || (!lifecycle.records.length && list.reviews.length)) { lifecycleUnavailable = true; continue; }
          for (const key of ["open", "resolved", "notDetected", "historical", "manualResolved", "verifiedResolved"] as const) findingStatus[key] += lifecycle.summary[key];
          for (const severity of ["critical", "high", "medium", "low"] as const) findingStatus.severities[severity] += lifecycle.summary.severities[severity];
          for (const review of overview.recent.filter(row => row.repositoryId === list.repositoryId)) {
            const states = lifecycle.statuses[review.id] ?? [];
            review.findingStates = { resolved: states.filter(s => s.status === "resolved").length, notDetected: states.filter(s => s.status === "not_detected").length, historical: states.filter(s => s.status === "historical").length };
          }
        }
      }
      return reviewJSON({ ...overview, ...(lifecycleUnavailable ? { findingStatusUnavailable: true } : { findingStatus }), realtime_channel: reviewChannel(access.organizationId) });
    }
    if (request.method === "GET" && ["jobs", "job", "report", "activity"].includes(action)) {
      const jobId = url.searchParams.get("jobId");
      if (jobId && !/^J-[a-f0-9]{32}$/.test(jobId)) throw new ReviewError(400, "Invalid review ID.");
      const target = (await historyTargets()).find(target => target.repo.id === repository);
      if (!target) throw new ReviewError(403, "This repository has no saved review access in this workspace.");
      const claims = connectionClaims(target.connection, repository);
      if (action === "jobs") {
        const result = await send("/jobs", "GET", undefined, claims);
        await lifecycle.settle(access.organizationId, result);
        const rows = (Array.isArray(result.reviews) ? result.reviews : []).filter((row: ReviewJob) => row.snapshot.repository_id === String(repository));
        return reviewJSON({ ...result, reviews: await withFindingSummaries(rows, target) });
      }
      if (!jobId) throw new ReviewError(400, "Choose a review.");
      if (action === "activity") {
        const after = Number(url.searchParams.get("after") || 0);
        if (!Number.isSafeInteger(after) || after < 0 || after > 2003) throw new ReviewError(400, "Invalid activity cursor.");
        return reviewJSON(await send(`/jobs/${jobId}/activity?after=${after}`, "GET", undefined, claims));
      }
      const result = await send(`/jobs/${jobId}${action === "report" ? "/report" : ""}`, "GET", undefined, claims);
      if (action === "job") return reviewJSON((await withFindingSummaries([result as ReviewJob], target))[0]);
      if (action === "report") {
        try {
          const lifecycle = await statuses.read({ repositoryId: repository, repository: target.repo.fullName, claims });
          return reviewJSON({ ...result, finding_statuses: lifecycle.statuses[jobId] });
        } catch (error) { captureError("review.finding_status", error, { repositoryId: repository }); }
      }
      return reviewJSON(result);
    }
    const listRepositories = async () => {
      const runtime = runtimeEngineOrigin();
      const routes = runtime ? {} : engineRoutes();
      const targets = access.connections.flatMap((connection) => {
        const repositories = JSON.parse(connection.repositories) as Repository[];
        // A routed installation can span multiple isolated repository workers.
        // Keep the legacy installation-list request when no routes are configured.
        return runtime || repositories.some((repo) => routes[`${access.organizationId}:${repo.id}`])
          ? repositories.map((repo) => ({ connection, repository: repo.id }))
          : [{ connection, repository: 0 }];
      });
      const outcomes: PromiseSettledResult<{ connection: typeof access.connections[number]; result: { repositories: ReviewRepository[]; [key: string]: unknown } }>[] = [];
      // Bound concurrent live GitHub checks, even for large installations.
      for (let start = 0; start < targets.length; start += 4) {
        outcomes.push(...await Promise.allSettled(targets.slice(start, start + 4).map(async ({ connection, repository }) => ({ connection,
          result: await send("/github/repositories", "GET", undefined, connectionClaims(connection, repository)),
        }))));
      }
      const failed = new Set<string>();
      for (const [index, outcome] of outcomes.entries()) if (outcome.status === "rejected") {
        failed.add(targets[index].connection.accountLogin);
        captureError("review.repositories", outcome.reason, { connectionId: targets[index].connection.id, account: targets[index].connection.accountLogin, repositoryId: targets[index].repository });
      }
      const lists = outcomes.flatMap((outcome) => outcome.status === "fulfilled" ? [outcome.value] : []);
      if (!lists.length) throw (outcomes[0] as PromiseRejectedResult).reason;
      return { lists, unavailable: failed.size, unavailableAccounts: [...failed] };
    };
    if (request.method === "GET" && action === "repositories") {
      const { lists, unavailable, unavailableAccounts } = await listRepositories();
      return reviewJSON({ ...lists[0].result, repositories: [...new Map(lists.flatMap(({ result }) => result.repositories).map((repo) => [repo.id, repo])).values()], unavailable_connections: unavailable, unavailable_accounts: unavailableAccounts, realtime_channel: reviewChannel(access.organizationId) });
    }
    // Cached selections route requests; the engine still checks each request scope.
    if (!activeTargets.some(target => target.repo.id === repository) && (await historyTargets()).some(target => target.repo.id === repository)
      && !(action === "cancel" || (action === "fix" && request.method === "GET" && url.searchParams.get("checkPull") !== "1"))) {
      throw new ReviewError(403, "This repository is no longer connected. Saved reviews are read-only.");
    }
    let connection = access.connections.length === 1 ? access.connections[0] : access.connections.find((candidate) => (JSON.parse(candidate.repositories) as Repository[]).some((repo) => repo.id === repository));
    if (!connection && (action === "cancel" || (action === "fix" && request.method === "GET"))) connection = (await historyTargets()).find(target => target.repo.id === repository)?.connection;
    if (!connection) connection = (await listRepositories()).lists.find(({ result }) => result.repositories.some((repo) => repo.id === repository))?.connection;
    if (!connection) throw new ReviewError(403, "This repository is not connected to this workspace.");
    const claims = connectionClaims(connection, repository);
    const jobId = url.searchParams.get("jobId");
    if (jobId && !/^J-[a-f0-9]{32}$/.test(jobId)) throw new ReviewError(400, "Invalid review ID.");
    if (request.method === "GET") {
      if (action === "configuration") {
        const [policy, byok] = await Promise.all([send("/github/repositories", "GET", undefined, claims), providerState(access.organizationId)]);
        return reviewJSON({ ...policy, byok_credential_id: byok.review_provider === "byok" ? byok.connection?.id || "" : "" });
      }
      if (action === "pull-title") {
        const number = Number(url.searchParams.get("number"));
        if (!Number.isSafeInteger(number) || number < 1) throw new ReviewError(400, "Invalid pull request number.");
        return reviewJSON(await send(`/github/pulls/${number}/title`, "GET", undefined, claims));
      }
      if (action === "pulls") {
        const page = Number(url.searchParams.get("page") || 1);
        if (!Number.isInteger(page) || page < 1 || page > 100) throw new ReviewError(400, "Invalid page.");
        return reviewJSON(await send(`/github/pulls?page=${page}`, "GET", undefined, claims));
      }
    }
    if (action === "fix" && jobId && ["GET", "POST"].includes(request.method)) {
      const input = request.method === "POST" ? await readReviewJSON(request) : undefined;
      // Forward consent/retry intent only; browsers cannot provide repair bytes,
      // publication branches or other executor inputs.
      const body = input ? { ...(input.retry_of !== undefined ? { retry_of: input.retry_of } : {}),
        ...(input.approval !== undefined ? { approval: input.approval } : {}) } : undefined;
      const checkPull = request.method === "GET" && url.searchParams.get("checkPull") === "1";
      return reviewJSON(await send(`/jobs/${jobId}/fix${checkPull ? "?check_pull=1" : ""}`, request.method as "GET" | "POST", body, claims));
    }
    if (request.method === "POST") {
      const body = await readReviewJSON(request);
      if (action === "start") {
		if (body.model_id !== undefined && (typeof body.model_id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9.:-]{0,199}$/.test(body.model_id))) throw new ReviewError(400, "Choose a model from the Bedrock list.");
		if (body.retry_of !== undefined && (typeof body.retry_of !== "string" || !/^J-[a-f0-9]{32}$/.test(body.retry_of))) throw new ReviewError(400, "Invalid retry review ID.");
        if (!Number.isSafeInteger(body.number) || Number(body.number) < 1 || typeof body.base_tip !== "string" || !/^[a-f0-9]{40}$/.test(body.base_tip) || typeof body.head !== "string" || !/^[a-f0-9]{40}$/.test(body.head)) throw new ReviewError(400, "Select a current pull request snapshot.");
        // Only a catalog model ID may cross this boundary. The engine resolves
        // its own pricing/limits and independently verifies AWS and GitHub access.
        return reviewJSON(await lifecycle.start(access, { repository_id: repository, number: body.number, base_tip: body.base_tip, head: body.head, ...(body.model_id ? { model_id: body.model_id } : {}), ...(body.retry_of ? { retry_of: body.retry_of } : {}) }, claims, send), 202);
      }
      if (action === "cancel" && jobId) return reviewJSON(await send(`/jobs/${jobId}/cancel`, "POST", {}, claims));
    }
    throw new ReviewError(405, "Method not allowed.");
  } catch (error) { return reviewFailure(error); }
}
