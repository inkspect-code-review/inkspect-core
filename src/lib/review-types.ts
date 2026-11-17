import type { ReviewCost } from "./review-cost";
import type { FindingStatusInfo } from "./finding-status";
export type ReviewRepository = { id: number; full_name: string; private: boolean; archived?: boolean };
export type ReviewModel = { id: string; name: string; provider: string; available: boolean; reason?: string; routing: string; input_nano_usd?: number; output_nano_usd?: number; budget_nano_usd?: number };
export type ReviewModels = { models: ReviewModel[]; default_model_id: string; region: string; checked_at: string };
export type OpenPull = { number: number; title: string; url: string; draft: boolean; base_tip: string; head: string };
export type ReviewFindingSummary = { open: number; urgent: boolean };
export type ReviewJob = { finding_summary?: ReviewFindingSummary; billing_usage?: { provider_cost?: ReviewCost }; error_message?: string; job: { id: string; status: string; attempts: number; cancel_requested: boolean; error_code?: string; created_at: string }; snapshot: { url: string; title?: string; repository_id: string; base_tip: string; base: string; head: string; review_model_id?: string; byok?: { credential_id: string; provider: string; model: string } } };
type Revision = { revision_id: string; repository_id: string };
type Location = { path: string; start_line: number; end_line: number };
export type ReviewReport = {
  scores?: { code_quality: ReviewScore; security: ReviewScore };
  change_alignment?: { level: string; rationale: string };
  presentation?: { version: number; markdown: string; github_summary: string; github_findings: Record<string, string>; finding_prompts: Record<string, string>; fix_prompt: string };
  decision: "needs_changes" | "needs_evidence" | "ready_for_human" | "ready_for_review";
  summary: string;
  run: { id: string; status: string; freshness: "current" | "stale"; coverage_complete: boolean; target: Revision; base: Revision; model: { provider: string; model_id: string }; model_execution?: { calls: number; charged_tokens: number }; review_notes?: { author: string; body: string }[];
    /** Changed files left out by the base revision's .inkspectignore. Present whenever the base has one. */
    exclusions?: { excluded_files: number; ignore: { revision: Revision; digest: string } } };
  findings: { id: string; title: string; severity: string; reason: string; suggestion: string; verification: string; location: Location; evidence_ids: string[]; advisory?: boolean }[];
  evidence: { id: string; kind: string; origin: string; outcome: string; revision: Revision; location?: Location; execution_id?: string; artifact_ref?: string }[];
  verification_gaps: { reason: string; blocking: boolean }[];
  assessments: { target: { kind: string; id: string }; status: string; reason: string; evidence_ids: string[] }[];
  diagram?: { title: string; view: string; nodes: { id: string; label: string; issue?: boolean; evidence_ids?: string[] }[]; edges: { from: string; to: string; label?: string; missing?: boolean; evidence_ids?: string[] }[] };
  presentation_notes?: string[];
};
export type ReviewScore = { score: number; rationale?: string; to_improve?: string };
export type ReportResponse = { report: ReviewReport; fix_prompt: string; finding_prompts: Record<string, string>; finding_statuses?: FindingStatusInfo[]; freshness_check: "verified" | "unavailable" | "not_checked"; freshness_checked_at?: string };
