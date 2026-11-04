export const knowledgeContentLimit = 64 * 1024;
export const knowledgeTitleLimit = 200;

export type KnowledgeDocumentSummary = { id: string; title: string; excerpt: string; createdAt: string };
export type KnowledgeDocument = KnowledgeDocumentSummary & { content: string };

export function validateKnowledgeDocument(title: string, content: string) {
  if (!title.trim() || title.trim().length > knowledgeTitleLimit || new TextEncoder().encode(title.trim()).length > 500) {
    return "Enter a title of up to 200 characters (500 bytes).";
  }
  if (!content.trim()) return "Write some content or upload a Markdown file.";
  if (new TextEncoder().encode(content).length > knowledgeContentLimit) return "Keep the document under 64 KB.";
  if (content.includes("\0") || content.includes("\uFFFD")) return "Use a UTF-8 text document without binary content.";
  return null;
}

export function markdownFileTitle(filename: string) {
  return filename.replace(/\.(md|markdown)$/i, "").replace(/[-_]+/g, " ").trim().slice(0, knowledgeTitleLimit);
}
