// Shared by browser and server. Never collect request/response bodies or headers.
const sensitiveKey = /password|passwd|secret|token|authorization|cookie|private.?key|api.?key|signature|credential|^state$|^body$|^headers$|^query$|^params$|^content$/i;
export function safePath(value: string) {
  try { return new URL(value, "http://local.invalid").pathname; } catch { return "[invalid path]"; }
}
export function redactText(value: string, secrets: string[] = []) {
  let result = value;
  for (const secret of secrets) {
    if (secret.length < 4) continue;
    for (const variant of [secret, encodeURIComponent(secret)]) result = result.split(variant).join("[REDACTED]");
  }
  return result
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, "[REDACTED PRIVATE KEY]")
    .replace(/\b(?:https?|postgres(?:ql)?|redis(?:s)?):\/\/[^\s<>"']+/gi, (raw) => {
      try { const url = new URL(raw); url.username = ""; url.password = ""; url.search = ""; url.hash = ""; return url.toString(); } catch { return "[REDACTED URL]"; }
    })
    .replace(/([?&](?:[^\s=&]+)=)[^\s&#]*/g, "$1[REDACTED]")
    .replace(/((?:set-cookie|cookie)\s*:\s*)[^\r\n]+/gi, "$1[REDACTED]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g, "[REDACTED TOKEN]")
    .replace(/((?:[\w-]*(?:password|secret|token|api[_-]?key|authorization|cookie|signature|credential)[\w-]*|state|code)["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;\n}]+)/gi, "$1[REDACTED]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[REDACTED EMAIL]")
    .slice(0, 12_000);
}
export function sanitize(value: unknown, secrets: string[] = [], depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return redactText(value, secrets);
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value !== "object") return String(value).slice(0, 100);
  if (seen.has(value)) return "[Circular]";
  if (depth >= 5) return "[Truncated]";
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 10).map((item) => sanitize(item, secrets, depth + 1, seen));
  // Error fields are non-enumerable; explicitly retain the original message,
  // even for libraries which intentionally leave stack empty (Better Auth).
  const fields = value instanceof Error
    ? ["name", "message", "stack", "code", "status", "statusCode", "digest", "cause", "errors"]
    : Object.keys(value).slice(0, 40);
  const output: Record<string, unknown> = {};
  for (const key of fields) {
    if (["__proto__", "constructor", "prototype"].includes(key)) continue;
    try {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) output[key] = sensitiveKey.test(key) ? "[REDACTED]" : sanitize(entry, secrets, depth + 1, seen);
    } catch { output[key] = "[Unreadable]"; }
  }
  return output;
}
