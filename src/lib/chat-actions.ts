export type ChatIndexAction = { type: "index_repository"; repositoryId: number; repository: string };
export type ChatIndexAvailability = { repositoryId: number; repository: string; state: "not_indexed" | "indexing" | "index_failed"; canIndex: boolean };

// Actions are server-created capabilities to offer, never model-generated commands.
export function chatIndexActions(statuses: ChatIndexAvailability[] = []): ChatIndexAction[] {
  return statuses.filter(item => item.canIndex && item.state !== "indexing")
    .map(item => ({ type: "index_repository", repositoryId: item.repositoryId, repository: item.repository }));
}
export function parseChatActions(raw: string | undefined): ChatIndexAction[] {
  try {
    const value: unknown = JSON.parse(raw || "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is ChatIndexAction => item?.type === "index_repository"
      && Number.isSafeInteger(item.repositoryId) && item.repositoryId > 0
      && typeof item.repository === "string" && /^[\w.-]+\/[\w.-]+$/.test(item.repository))
      .map(({ type, repositoryId, repository }) => ({ type, repositoryId, repository }));
  } catch { return []; }
}
