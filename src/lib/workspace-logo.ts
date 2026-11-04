export const workspaceLogoMaxBytes = 2 * 1024 * 1024;
export const workspaceLogoTypes = ["image/png", "image/jpeg", "image/webp"] as const;

export function workspaceLogoURL(organizationId: string, version: string) {
  return `/api/workspace-logo?${new URLSearchParams({ organizationId, v: version })}`;
}

// Only display assets belonging to this workspace, never arbitrary remote URLs.
export function workspaceLogoVersion(organizationId: string, logo?: string | null): string | null {
  if (!logo?.startsWith("/api/workspace-logo?")) return null;
  const url = new URL(logo, "https://inkspect.invalid");
  const version = url.searchParams.get("v");
  if (url.pathname !== "/api/workspace-logo" || url.searchParams.get("organizationId") !== organizationId || !version || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(version)) return null;
  return version;
}

export function workspaceLogoSource(organizationId: string, logo?: string | null) {
  const version = workspaceLogoVersion(organizationId, logo);
  return version ? workspaceLogoURL(organizationId, version) : null;
}
