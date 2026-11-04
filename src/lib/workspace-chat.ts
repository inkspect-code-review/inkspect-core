import type { ChatReference } from "./chat-review-evidence";
import type { ChatIndexAction } from "./chat-actions";
export type ChatScope = "all" | string;
export type ChatConversation = {
  id: string; title: string; repositoryScope: ChatScope; shared: boolean; owner: boolean; authorName: string; updatedAt: string;
};
export type ChatMessage = { id: string; content: string; role?: "user" | "assistant"; sources?:ChatReference[]; actions?:ChatIndexAction[]; createdAt: string };
export type ChatDetail = { conversation: ChatConversation; messages: ChatMessage[] };
