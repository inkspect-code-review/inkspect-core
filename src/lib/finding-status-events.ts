import { publishTabRevision, subscribeTabRevision } from "./tab-revisions";

const eventName = "inkspect:findings-changed";
const storageKey = (organizationId: string) => `inkspect:findings:${organizationId}`;

export function announceFindingStatusChange(organizationId: string) {
  window.dispatchEvent(new CustomEvent(eventName, { detail: { organizationId } }));
  publishTabRevision(storageKey(organizationId), crypto.randomUUID(), window);
}

export function subscribeFindingStatusChanges(organizationId: string, refresh: () => void) {
  const local = (event: Event) => { if ((event as CustomEvent).detail?.organizationId === organizationId) refresh(); };
  const unsubscribe = subscribeTabRevision(storageKey(organizationId), refresh, window);
  window.addEventListener(eventName, local);
  return () => { window.removeEventListener(eventName, local); unsubscribe(); };
}
