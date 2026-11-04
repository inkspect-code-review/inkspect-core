import assert from "node:assert/strict";
import test from "node:test";
import { knowledgeExcerpt } from "../../src/lib/knowledge-excerpt";

test("document row previews show readable Markdown text instead of source syntax", () => {
  const markdown = "# Coding standards\n\nUse **strict** types and `unknown`. Read [the guide](https://example.com/guide).\n\n- [x] Validate inputs\n- Handle *errors*\n\n> Preserve context.\n\n| Language | Rule |\n| --- | --- |\n| Go | Check errors |";
  assert.equal(knowledgeExcerpt(markdown), "Coding standards Use strict types and unknown. Read the guide. Validate inputs Handle errors Preserve context. Language Rule Go Check errors");
});

test("previews preserve literal code and escaped punctuation without fences or link destinations", () => {
  assert.equal(knowledgeExcerpt("```ts\nconst value = a_b * 2;\n```\n\nKeep \\#tags and Type**Script**.\n\n[Docs][guide]\n\n[guide]: https://example.com\n\n![Architecture](https://example.com/image.png)"), "const value = a_b * 2; Keep #tags and TypeScript. Docs Architecture");
});

test("previews omit HTML and truncate after parsing without splitting emoji", () => {
  assert.equal(knowledgeExcerpt("<script>alert('hidden')</script>\n\n<!-- internal comment -->\n\nVisible **text**"), "Visible text");
  assert.equal(knowledgeExcerpt(`[Short label](https://example.com/${"x".repeat(300)})\n\nMore text.`), "Short label More text.");
  assert.equal(knowledgeExcerpt("**" + "🙂".repeat(181) + "**"), "🙂".repeat(179) + "…");
  assert.equal(knowledgeExcerpt("plain text"), "plain text");
});
