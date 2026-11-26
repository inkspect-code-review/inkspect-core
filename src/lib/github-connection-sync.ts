import { publishTabRevision, subscribeTabRevision } from "./tab-revisions";

type Scope = { userId: string; organizationId: string };
const storageKey = ({ userId, organizationId }: Scope) => `inkspect:github-connection:${JSON.stringify([userId, organizationId])}`;

export function announceGitHubConnectionChange(scope: Scope, revision: string, browser: Window = window) {
  publishTabRevision(storageKey(scope), revision, browser);
}

export function subscribeGitHubConnectionChanges(scope: Scope, refresh: () => void, browser: Window = window) {
  return subscribeTabRevision(storageKey(scope), refresh, browser);
}
