import type { OpenPull, ReviewJob } from "./review-types";

type ReviewAction = { kind: "start"; label: "Start review" } | { kind: "retry"; label: "Retry review"; jobId: string } | { kind: "view"; label: "View review"; jobId: string };

// Repeated admission without retry_of deliberately returns the original job.
// Choose the latest attempt for this exact repository and immutable PR snapshot.
export function reviewAction(rows: ReviewJob[], pull: OpenPull | undefined, repositoryId: number, modelId?: string, credentialId?: string): ReviewAction {
  if (!pull) return { kind: "start", label: "Start review" };
  const matching = rows.filter(({ snapshot }) => snapshot.repository_id === String(repositoryId) && snapshot.url === pull.url && snapshot.base_tip === pull.base_tip && snapshot.head === pull.head && (modelId === undefined || (snapshot.review_model_id || "") === modelId) && (credentialId === undefined || (snapshot.byok?.credential_id || "") === credentialId))
    .sort((a, b) => Date.parse(b.job.created_at) - Date.parse(a.job.created_at));
  const latest = matching.find(({ job }) => ["queued", "leased", "running", "paused"].includes(job.status)) || matching[0];
  if (!latest) return { kind: "start", label: "Start review" };
  if (["failed", "cancelled"].includes(latest.job.status)) return { kind: "retry", label: "Retry review", jobId: latest.job.id };
  return { kind: "view", label: "View review", jobId: latest.job.id };
}
