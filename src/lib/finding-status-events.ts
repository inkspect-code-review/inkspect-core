const eventName = "inkspect:findings-changed";
const storageKey = (organizationId: string) => `inkspect:findings:${organizationId}`;

export function announceFindingStatusChange(organizationId: string) {
  window.dispatchEvent(new CustomEvent(eventName, { detail: { organizationId } }));
  try { window.localStorage.setItem(storageKey(organizationId), crypto.randomUUID()); } catch { /* Other tabs also refresh on focus. */ }
}

export function subscribeFindingStatusChanges(organizationId: string, refresh: () => void) {
  const local = (event: Event) => { if ((event as CustomEvent).detail?.organizationId === organizationId) refresh(); };
  const storage = (event: StorageEvent) => { if (event.key === storageKey(organizationId) && event.newValue) refresh(); };
  window.addEventListener(eventName, local);
  window.addEventListener("storage", storage);
  window.addEventListener("focus", refresh);
  return () => { window.removeEventListener(eventName, local); window.removeEventListener("storage", storage); window.removeEventListener("focus", refresh); };
}
