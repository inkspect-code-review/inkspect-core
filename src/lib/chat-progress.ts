// Public activity labels only: never provider reasoning, queries or document text.
export const chatProgressLabels = {
  thinking: "Thinking",
  gathering: "Gathering sources",
  reading_reviews: "Reading reviews",
  reading_diagrams: "Reading diagrams",
  reading_knowledge: "Reading knowledge",
  answering: "Preparing answer",
} as const;
export type ChatProgress = keyof typeof chatProgressLabels;
export function isChatProgress(value: unknown): value is ChatProgress {
  return typeof value === "string" && Object.hasOwn(chatProgressLabels, value);
}
