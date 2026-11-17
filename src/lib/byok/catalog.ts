// Shared release catalog validated at API admission and engine credential loading.
import entries from "./models.json";
// Model IDs verified against provider documentation on 2026-11-17.
// context_tokens/output_tokens are conservative review execution budgets, not advertised model limits.
// Sources: https://developers.openai.com/api/docs/models
// https://platform.claude.com/docs/en/models/overview
// https://ai.google.dev/gemini-api/docs/models
export const byokModels = entries;
export const byokProviders = [{ id: "openai", name: "OpenAI" }, { id: "anthropic", name: "Anthropic" }, { id: "google", name: "Google" }];
export function supportedModel(provider: unknown, model: unknown) {
  return byokModels.find(entry => entry.provider === provider && entry.id === model);
}
