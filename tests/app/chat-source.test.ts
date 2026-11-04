import assert from "node:assert/strict";
import test from "node:test";
import { loadChatSource } from "../../src/lib/chat-source";
import type { ChatSource } from "../../src/lib/chat-context";
import type { GitHubConnection } from "../../src/lib/github";

const source: Omit<ChatSource, "content"> = { id: "S1", repository: "org/repo", repositoryId: 17, revision: "a".repeat(40), path: "src/socket.ts", startLine: 10, endLine: 11, url: "https://github.com/org/repo/blob/" + "a".repeat(40) + "/src/socket.ts#L10-L11" };
const connection: GitHubConnection = { id: "connection", organizationId: "workspace", installationId: "123", accountLogin: "org", repositories: JSON.stringify([{ id: 17, fullName: "org/repo", private: true }]), updatedAt: new Date() };
const packet = { content: "const socket = connect();\nawait socket.ready;\n", revision: source.revision, path: source.path, start_line: 10, end_line: 11 };

test("source preview reads the exact saved revision and line range with server-derived access", async () => {
  const result = await loadChatSource(source, "workspace", "user", [connection], async (path, method, body, claims) => {
    assert.equal(path, "/chat/source"); assert.equal(method, "POST");
    assert.deepEqual(body, { revision: source.revision, path: source.path, start_line: 10, end_line: 11 });
    assert.deepEqual(claims, { tenant: "workspace", subject: "user", connection: "connection", installation: 123, repository: 17 });
    return packet;
  });
  assert.equal(result.content, packet.content);
  assert.equal(result.url, source.url);
});

test("source preview rejects disconnected repositories and mismatched source responses", async () => {
  await assert.rejects(loadChatSource(source, "workspace", "user", [], async () => { assert.fail("must not call engine"); }), /no longer connected/);
  await assert.rejects(loadChatSource({ ...source, repositoryId: 18 }, "workspace", "user", [connection], async () => { assert.fail("must not call engine"); }), /no longer connected/);
  for (const changed of [{ revision: "b".repeat(40) }, { path: "other.ts" }, { start_line: 1 }, { end_line: 12 }, { content: null }]) {
    await assert.rejects(loadChatSource(source, "workspace", "user", [connection], async () => ({ ...packet, ...changed })), /could not be verified/);
  }
});
