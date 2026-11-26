import assert from "node:assert/strict";
import test from "node:test";
import { announceGitHubConnectionChange, subscribeGitHubConnectionChanges } from "../../src/lib/github-connection-sync";

function browserTabs(blockStorage = false) {
  const values = new Map<string, string>();
  const tabs: EventTarget[] = [];
  return () => {
    const tab = new EventTarget();
    tabs.push(tab);
    return Object.assign(tab, { localStorage: {
      getItem: (key: string) => {
        if (blockStorage) throw new Error("Storage is disabled");
        return values.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        if (blockStorage) throw new Error("Storage is disabled");
        if (values.get(key) === value) return;
        values.set(key, value);
        for (const other of tabs) if (other !== tab) other.dispatchEvent(Object.assign(new Event("storage"), { key, newValue: value }));
      },
    } }) as unknown as Window;
  };
}

test("a completed GitHub update refreshes other tabs only for the same user and workspace", () => {
  const createTab = browserTabs();
  const original = createTab(), callback = createTab();
  const scope = { userId: "owner", organizationId: "workspace" };
  let originalRefreshes = 0, callbackRefreshes = 0;
  const stopOriginal = subscribeGitHubConnectionChanges(scope, () => originalRefreshes++, original);
  const stopCallback = subscribeGitHubConnectionChanges(scope, () => callbackRefreshes++, callback);
  announceGitHubConnectionChange({ ...scope, organizationId: "other" }, "revision-1", callback);
  announceGitHubConnectionChange({ ...scope, userId: "other" }, "revision-1", callback);
  assert.equal(originalRefreshes, 0);
  announceGitHubConnectionChange(scope, "revision-1", callback);
  assert.equal(originalRefreshes, 1);
  assert.equal(callbackRefreshes, 0, "the return tab already has the saved server data");
  announceGitHubConnectionChange(scope, "revision-1", callback);
  assert.equal(originalRefreshes, 1, "rendering the same success page again must not cause a refresh loop");
  announceGitHubConnectionChange(scope, "revision-2", callback);
  assert.equal(originalRefreshes, 2);
  original.dispatchEvent(new Event("focus"));
  assert.equal(originalRefreshes, 2, "switching tabs does not reload the dashboard");
  stopOriginal(); stopCallback();
  announceGitHubConnectionChange(scope, "revision-3", callback);
  original.dispatchEvent(new Event("focus"));
  assert.equal(originalRefreshes, 2, "leaving a workspace removes its listeners");
});

test("storage-blocked tabs synchronize changes without reloading on focus", async () => {
  const createTab = browserTabs(true);
  const original = Object.assign(createTab(), { BroadcastChannel });
  const callback = Object.assign(createTab(), { BroadcastChannel });
  const scope = { userId: "owner", organizationId: "workspace" };
  let refreshed = 0;
  let received!: () => void;
  const update = new Promise<void>(resolve => { received = resolve; });
  const stop = subscribeGitHubConnectionChanges(scope, () => { refreshed++; received(); }, original);
  try {
    original.dispatchEvent(new Event("focus"));
    assert.equal(refreshed, 0);
    announceGitHubConnectionChange(scope, "revision-1", callback);
    await update;
    original.dispatchEvent(new Event("focus"));
    assert.equal(refreshed, 1);
  } finally { stop(); }
});
