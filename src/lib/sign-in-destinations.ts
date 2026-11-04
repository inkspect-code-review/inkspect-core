// A fixed internal destination may survive sign-in even when the current
// edition does not register that optional page. The edition resolves the page.
export function isOpenSourceApplicationPath(value: unknown): value is string {
  return typeof value === "string" && /^\/dashboard\?view=support&reason=open-source(?:&repository=[1-9][0-9]{0,15})?$/.test(value);
}
