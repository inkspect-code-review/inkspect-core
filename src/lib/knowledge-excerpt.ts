import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

const parser = unified().use(remarkParse).use(remarkGfm);
type MarkdownNode = {
  type: string;
  value?: string;
  alt?: string | null;
  children?: MarkdownNode[];
};
const blockContainers = new Set(["root", "blockquote", "list", "listItem", "table", "tableRow", "footnoteDefinition"]);

function plainText(node: MarkdownNode): string {
  if (node.type === "text" || node.type === "inlineCode" || node.type === "code") return node.value ?? "";
  if (node.type === "image" || node.type === "imageReference") return node.alt ?? "";
  if (node.type === "break") return " ";
  // HTML, reference definitions, and other syntax are not visible summary text.
  if (!node.children) return "";
  return node.children.map(plainText).filter(Boolean).join(blockContainers.has(node.type) ? " " : "");
}

export function knowledgeExcerpt(content: string): string {
  // Parse before truncating so link labels, tables, and fences stay intact.
  const text = plainText(parser.parse(content)).replace(/\s+/gu, " ").trim();
  const characters = Array.from(text);
  return characters.length > 180 ? `${characters.slice(0, 179).join("")}…` : text;
}
