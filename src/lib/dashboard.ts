import type { WorkspaceStatus } from "./workspace-status";

export function workspaceHomeHref(status?: WorkspaceStatus) {
  return status?.canManage && !status.connections.length && !status.dismissed
    ? "/onboarding"
    : "/dashboard";
}

export const dashboardSections = [
  { id: "dashboard", name: "Dashboard", description: "Your workspace at a glance." },
  { id: "reviews", name: "Reviews", description: "A closer look at every pull request." },
  { id: "findings", name: "Findings", description: "Recent findings across your workspace. Open a finding to see its review." },
  { id: "repositories", name: "Repositories", description: "The code your organization brings to Inkspect." },
  { id: "integrations", name: "Integrations", description: "Manage connections to your code, project tools, and team documentation." },
  { id: "knowledge", name: "Knowledge Center", description: "Shared context for reviews that understand your code." },
  { id: "members", name: "Members", description: "The people in your organization." },
  { id: "usage", name: "Usage", description: "AI usage across embedding, reviews, and chat." },
  { id: "settings", name: "Settings", description: "Your workspace appearance, organization, and account." },
] as const;

export type DashboardSection = typeof dashboardSections[number]["id"] | (string & {});
export type DashboardOrganization = { id: string; name: string; slug: string; logo?: string | null };
// Member-dependent views identify the user, not the membership record.
export type DashboardMember = { id: string; name: string; email: string; role: string };

export type DashboardSummary = { memberCount: number; asOf: string };
