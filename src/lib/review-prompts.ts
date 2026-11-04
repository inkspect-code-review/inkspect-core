import type { ReportResponse } from "./review-types";

export function findingFixPrompt(value: ReportResponse, findingId: string) {
  const direct = value.finding_prompts[findingId];
  if (direct?.trim()) return direct;
  return value.report.presentation?.finding_prompts[findingId] || "";
}

export function allFindingFixPrompts(value: ReportResponse) {
  if (!value.report.findings.length) return "";
  const prompts = value.report.findings.map(finding => findingFixPrompt(value, finding.id));
  if (prompts.every(prompt => prompt.trim())) return prompts.join("\n\n---\n\n");
  // Use the engine's combined prompt when older reports lack individual prompts.
  // Never silently copy an incomplete set of findings.
  return value.fix_prompt?.trim() ? value.fix_prompt : value.report.presentation?.fix_prompt || "";
}
