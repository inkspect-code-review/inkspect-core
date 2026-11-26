// Tabs exchange a revision only. Subscribers reload data through their own session.
type RevisionWindow = Window & { BroadcastChannel?: typeof BroadcastChannel };

function openChannel(browser: RevisionWindow, key: string) {
  try { return browser.BroadcastChannel ? new browser.BroadcastChannel(key) : null; }
  catch { return null; }
}

export function publishTabRevision(key: string, revision: string, browser: RevisionWindow) {
  try { browser.localStorage.setItem(key, revision); }
  catch {
    const channel = openChannel(browser, key);
    try { channel?.postMessage(revision); } finally { channel?.close(); }
  }
}

export function subscribeTabRevision(key: string, refresh: () => void, browser: RevisionWindow) {
  let revision: string | null = null;
  let channel: BroadcastChannel | null = null;
  const changed = (value: unknown) => {
    if (typeof value !== "string" || !value || value === revision) return;
    revision = value;
    refresh();
  };
  try { revision = browser.localStorage.getItem(key); }
  catch {
    channel = openChannel(browser, key);
    if (channel) channel.onmessage = event => changed(event.data);
  }
  const onStorage = (event: StorageEvent) => { if (event.key === key) changed(event.newValue); };
  browser.addEventListener("storage", onStorage);
  return () => { browser.removeEventListener("storage", onStorage); channel?.close(); };
}
