import type { ChatFrame } from "./chat-window-geometry";

export type ChatWindowState = { open: boolean; expanded: boolean; frame: ChatFrame | null; conversationId: string | null; draft: string; drafts: Record<string, string>; repositoryScope: string };
export const emptyChatWindow: ChatWindowState = { open: false, expanded: false, frame: null, conversationId: null, draft: "", drafts: {}, repositoryScope: "all" };
export const chatDraftKey = (conversationId: string | null) => conversationId === null ? "new" : `conversation:${conversationId}`;

export function updateChatWindow(current: ChatWindowState, changes: Partial<ChatWindowState>): ChatWindowState {
  const drafts = { ...current.drafts };
  // A draft edit belongs to the current conversation, including clearing it
  // after sending the first message and receiving a new conversation ID.
  if (changes.draft !== undefined) {
    const key = chatDraftKey(current.conversationId);
    if (changes.draft) drafts[key] = changes.draft;
    else delete drafts[key];
  }
  const next = { ...current, ...changes, drafts };
  return { ...next, draft: drafts[chatDraftKey(next.conversationId)] ?? "" };
}

export function restoreChatDrafts(saved: { drafts?: unknown; draft?: unknown }, conversationId: string | null): Record<string, string> {
  if (saved.drafts && typeof saved.drafts === "object" && !Array.isArray(saved.drafts)) {
    return Object.fromEntries(Object.entries(saved.drafts).filter(([key, value]) =>
      (key === "new" || (key.startsWith("conversation:") && key.length <= 213)) && typeof value === "string"
    ).map(([key, value]) => [key, value as string]));
  }
  // Preserve drafts saved before conversations had separate draft slots.
  return typeof saved.draft === "string" && saved.draft ? { [chatDraftKey(conversationId)]: saved.draft } : {};
}
