import { createHash } from "node:crypto";

type ProviderSelection = { credential_id: string; provider: string; model: string };
export type ReviewIdentityInput = { organization: string; user: string; repository: number; connection: string; installation: number; body: Record<string, unknown> };
export function engineJobId(request: string) { return `J-${createHash("sha256").update(`rust:${request}`).digest("hex").slice(0, 32)}`; }

export function requestIdentity(input: ReviewIdentityInput) {
  const identity = [input.organization, input.repository, input.connection, input.installation, input.body.number, input.body.base_tip, input.body.head, input.body.retry_of || ""];
  if (input.body.fix_of) identity.push("fix", input.body.fix_of);
  // Preserve legacy/default identities while separating attempts by model.
  if (input.body.model_id) identity.push(input.body.model_id);
  if (input.body.byok) { const s=input.body.byok as ProviderSelection; identity.push("byok",s.credential_id,s.provider,s.model); }
  if (input.body.rerun_of) identity.push("rerun", input.body.rerun_of);
  // Each set of participant notes is a distinct review, matching the engine key.
  if (input.body.review_notes) identity.push("notes", createHash("sha256").update(JSON.stringify(input.body.review_notes)).digest("hex"));
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}
