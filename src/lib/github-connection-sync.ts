type Scope = { userId: string; organizationId: string };
const storageKey = ({ userId, organizationId }: Scope) => `inkspect:github-connection:${JSON.stringify([userId, organizationId])}`;

// Only a revision is shared. Each tab reloads the authorized workspace data
// from the server instead of trusting repository data from another tab.
export function announceGitHubConnectionChange(scope: Scope, revision: string, browser: Window = window) {
  try { browser.localStorage.setItem(storageKey(scope), revision); }
  catch { /* Returning focus still refreshes tabs when storage is blocked. */ }
}

export function subscribeGitHubConnectionChanges(scope: Scope, refresh: () => void, browser: Window = window) {
  const key = storageKey(scope);
  let revision: string | null = null;
  try { revision = browser.localStorage.getItem(key); } catch { /* Storage can be disabled. */ }
  const onStorage = (event: StorageEvent) => {
    if (event.key !== key || !event.newValue || event.newValue === revision) return;
    revision = event.newValue;
    refresh();
  };
  browser.addEventListener("storage", onStorage);
  browser.addEventListener("focus", refresh);
  return () => {
    browser.removeEventListener("storage", onStorage);
    browser.removeEventListener("focus", refresh);
  };
}
