// Shared release catalog validated at API admission and engine credential loading.
import entries from "./models.json";
export const byokModels = entries;
export const byokProviders = [{ id: "openai", name: "OpenAI" }, { id: "anthropic", name: "Anthropic" }, { id: "google", name: "Google" }];
export function supportedModel(provider: unknown, model: unknown) {
  return byokModels.find(entry => entry.provider === provider && entry.id === model);
}
