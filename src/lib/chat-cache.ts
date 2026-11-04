export type TextBlock = { text: string; cachePoint?: never };
export type CacheBlock = { cachePoint: { type: "default" }; text?: never };
export type ConverseInput = {
  system: (TextBlock | CacheBlock)[];
  messages: { role: "user" | "assistant"; content: (TextBlock | CacheBlock)[] }[];
};

// Nova's explicit cache is limited to 20K tokens. UTF-8 bytes plus a framing
// reserve are a conservative upper bound; do not assume four chars per token.
// Bedrock skips checkpoints below its 1K-token minimum. Never pad a prompt.
export function addChatCachePoints(input: ConverseInput, config: { model: string; promptCaching?: boolean }) {
  if (config.promptCaching === false || !/^(?:(?:eu|us|apac)\.)?amazon\.nova-(?:pro|lite|micro)-v1:0$/.test(config.model)) return;
  let bytes = 1024 + Buffer.byteLength(JSON.stringify(input.system));
  const point = (): CacheBlock => ({ cachePoint: { type: "default" } });
  if (bytes > 18_000) return;
  input.system.push(point());
  const eligible: number[] = [];
  for (let index = 0; index < input.messages.length; index++) {
    bytes += Buffer.byteLength(JSON.stringify(input.messages[index])) + 128;
    if (bytes > 18_000) break;
    if (input.messages[index].role === "user") eligible.push(index);
  }
  // Keep an earlier matching checkpoint and write the next reusable prefix.
  for (const index of eligible.slice(-2)) input.messages[index].content.push(point());
}
