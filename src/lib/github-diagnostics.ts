import { githubFailureReason } from "./github-errors";
import { captureError } from "./diagnostics/server";
export function logGitHubFailure(stage: "start" | "setup" | "callback", error: unknown) {
  const reason = githubFailureReason(error);
  const eventId = captureError("github.connection", error, { stage, reason });
  console.error(`GitHub connection failed. ${JSON.stringify({ stage, reason, eventId })}`);
  return reason;
}
