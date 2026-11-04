import { AIError } from "./bedrock";

export type ChatTokenUsage = { inputTokens: number; outputTokens: number; totalTokens: number; cacheReadInputTokens?: number; cacheWriteInputTokens?: number };
type Rates = { inputRate?: bigint; outputRate?: bigint; cacheReadRate?: bigint | string; cacheWriteRate?: bigint | string };

export function chatUsage(value: unknown, rates: Rates) {
  const usage = value as ChatTokenUsage | undefined;
  const read = usage?.cacheReadInputTokens ?? 0, write = usage?.cacheWriteInputTokens ?? 0;
  if (!usage || ![usage.inputTokens, usage.outputTokens, usage.totalTokens, read, write].every(n => Number.isSafeInteger(n) && n >= 0)) {
    throw new AIError(502, "The AI reply or usage couldn’t be verified. Your question is saved.");
  }
  const uncachedTotal = usage.inputTokens + usage.outputTokens;
  const total = uncachedTotal + read + write;
  // Bedrock model adapters can report totals with or without the separate cache
  // counters. Validate either documented component sum; normalize our receipt.
  if (!Number.isSafeInteger(total) || (usage.totalTokens !== uncachedTotal && usage.totalTokens !== total)) {
    throw new AIError(502, "The AI reply or usage couldn’t be verified. Your question is saved.");
  }
  const known = rates.inputRate !== undefined && rates.outputRate !== undefined
    && (!read || rates.cacheReadRate !== undefined) && (!write || rates.cacheWriteRate !== undefined);
  const scaled = (rate: bigint | string | undefined) => {
    const [whole, fractional = ""] = String(rate ?? 0n).split(".");
    return BigInt(whole) * 1_000_000n + BigInt(fractional.padEnd(6,"0"));
  };
  const charge = known ? BigInt(usage.inputTokens) * scaled(rates.inputRate) + BigInt(usage.outputTokens) * scaled(rates.outputRate)
    + BigInt(read) * scaled(rates.cacheReadRate) + BigInt(write) * scaled(rates.cacheWriteRate) : undefined;
  return {
    inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: total,
    cacheReadInputTokens: read, cacheWriteInputTokens: write,
    // Round only once, at the request boundary, to the nearest nano-dollar.
    ...(charge !== undefined ? {chargedNanoUSD:((charge + 500_000n) / 1_000_000n).toString()} : {}),
  };
}
