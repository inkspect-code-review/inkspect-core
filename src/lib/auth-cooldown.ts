export type LoginMethod = "social" | "email";

export function retryDeadline(headers: Headers, now = Date.now()): number {
  for (const name of ["x-retry-after", "retry-after"]) {
    const value = headers.get(name)?.trim();
    if (!value) continue;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return now + Math.ceil(seconds) * 1000;
    if (name === "retry-after") {
      const date = Date.parse(value);
      if (Number.isFinite(date)) return Math.max(now, date);
    }
  }
  // The configured auth windows are 60 seconds if a proxy strips the header.
  return now + 60_000;
}

export function remainingSeconds(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
