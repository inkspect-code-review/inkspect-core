import type { ChatSource } from "./chat-context";
import type { GitHubConnection, Repository } from "./github";
import { engineRequest } from "./engine-client";
import { ReviewError } from "./review-access";

export async function loadChatSource(source: Omit<ChatSource, "content">, organizationId: string, userId: string, connections: GitHubConnection[], send = engineRequest): Promise<ChatSource> {
  const connection = connections.find(c => (JSON.parse(c.repositories) as Repository[]).some(r => r.id === source.repositoryId && r.fullName === source.repository));
  if (!connection) throw new ReviewError(403, "This repository is no longer connected to the workspace.");
  const result = await send("/chat/source", "POST", { revision: source.revision, path: source.path, start_line: source.startLine, end_line: source.endLine }, {
    tenant: organizationId, subject: userId, connection: connection.id, installation: Number(connection.installationId), repository: source.repositoryId,
  }) as { content?: unknown; revision?: string; path?: string; start_line?: number; end_line?: number };
  if (typeof result.content !== "string" || result.revision !== source.revision || result.path !== source.path || result.start_line !== source.startLine || result.end_line !== source.endLine) throw new ReviewError(502, "The source snippet could not be verified.");
  return { ...source, content: result.content };
}
