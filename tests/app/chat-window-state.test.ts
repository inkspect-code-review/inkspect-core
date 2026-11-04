import assert from "node:assert/strict";
import { test } from "node:test";
import { chatDraftKey, emptyChatWindow, restoreChatDrafts, updateChatWindow } from "../../src/lib/chat-window-state";

test("switching conversations preserves separate drafts, including a new chat, after reload", () => {
  let state = updateChatWindow(emptyChatWindow, { draft: "Unsent new question", repositoryScope: "123" });
  state = updateChatWindow(state, { conversationId: "first" });
  assert.equal(state.draft, "");
  state = updateChatWindow(state, { draft: "First conversation draft" });
  state = updateChatWindow(state, { conversationId: "second" });
  state = updateChatWindow(state, { draft: "Second conversation draft" });
  const saved = JSON.parse(JSON.stringify(state));
  state = { ...saved, drafts: restoreChatDrafts(saved, saved.conversationId) };
  state = updateChatWindow(state, { conversationId: "first" });
  assert.equal(state.draft, "First conversation draft");
  state = updateChatWindow(state, { conversationId: null });
  assert.equal(state.draft, "Unsent new question");
  assert.equal(state.repositoryScope, "123");
  state = updateChatWindow(state, { conversationId: "second" });
  assert.equal(state.draft, "Second conversation draft");
});

test("sending the first message clears only the new-chat draft when its ID changes", () => {
  let state = updateChatWindow(emptyChatWindow, { conversationId: "existing" });
  state = updateChatWindow(state, { draft: "Keep this" });
  state = updateChatWindow(state, { conversationId: null });
  state = updateChatWindow(state, { draft: "Send this" });
  state = updateChatWindow(state, { conversationId: "created", draft: "" });
  assert.equal(state.draft, "");
  state = updateChatWindow(state, { conversationId: null });
  assert.equal(state.draft, "");
  state = updateChatWindow(state, { conversationId: "existing" });
  assert.equal(state.draft, "Keep this");
});

test("clearing a conversation draft preserves the other conversation's draft", () => {
  let state = updateChatWindow(emptyChatWindow, { draft: "New chat draft" });
  state = updateChatWindow(state, { conversationId: "first" });
  state = updateChatWindow(state, { draft: "Clear this" });
  state = updateChatWindow(state, { draft: "" });
  state = updateChatWindow(state, { conversationId: null });
  assert.equal(state.draft, "New chat draft");
  state = updateChatWindow(state, { conversationId: "first" });
  assert.equal(state.draft, "");
});

test("old single drafts migrate into their conversation without resurrecting cleared drafts", () => {
  assert.deepEqual(restoreChatDrafts({ draft: "Previous draft" }, "first"), { [chatDraftKey("first")]: "Previous draft" });
  assert.deepEqual(restoreChatDrafts({ draft: "Previous draft" }, null), { new: "Previous draft" });
  assert.deepEqual(restoreChatDrafts({ drafts: {}, draft: "Stale draft" }, "first"), {});
  assert.deepEqual(restoreChatDrafts({ drafts: { new: 123, unrelated: "Ignore", "conversation:first": "Valid" } }, "first"), { "conversation:first": "Valid" });
});

test("long chat drafts survive reload without the former 8,000 character truncation",()=>{
 const content="Long code question. ".repeat(1000);
 assert.equal(restoreChatDrafts({drafts:{new:content}},null).new,content);
});
