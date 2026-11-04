import { dashboardSections, type DashboardSection } from "./dashboard";

export type DashboardEdition = {
  reviewPausedMessage: string;
  automaticReviewNote: string;
  automaticFixNote: string;
  providerCostNote: string;
  fix: { pausedStatus: string; pausedMessage: string; managedDescription: string; byokDescription: string };
  sections: readonly { id: DashboardSection; name: string; description: string; compactHeading?: boolean }[];
  navigation: readonly { title: string; sections: readonly DashboardSection[] }[];
  accountSections: readonly DashboardSection[];
  organizationRestriction: { title: string; description: string; label: string; action?: { href: string; label: string } };
  provider: { managedLabel: string; byokLabel: string; description: string; unavailable: string; action?: { href: string; label: string }; managedAvailable: boolean };
};

// UI capabilities only. The server must authorize every operation independently.
export const selfHostedDashboardEdition: DashboardEdition = {
  reviewPausedMessage: "This review is paused. Check your instance’s provider configuration and limits before resuming.",
  automaticReviewNote: "Enabled by default for every workspace. Reviews use the configured review provider.",
  automaticFixNote: "Off by default. Applies to reviews completed after enabling it. Uses the configured review provider. Inkspect fix commits are reviewed without starting another automatic fix.",
  providerCostNote: "Usage × provider list prices (USD). Excludes tax, discounts and shared infrastructure.",
  fix: {
    pausedStatus: "Fix paused", pausedMessage: "Check your instance’s provider configuration and limits before resuming this fix.",
    managedDescription: "Uses the instance provider. Updates the existing PR branch.",
    byokDescription: "Uses your organization provider. Updates the existing PR branch.",
  },
  sections: dashboardSections,
  navigation: [
    { title: "Workspace", sections: ["dashboard", "reviews", "findings", "repositories", "knowledge"] },
    { title: "Organization", sections: ["members", "integrations", "usage", "settings"] },
  ],
  accountSections: ["settings"],
  organizationRestriction: {
    title: "Organization creation unavailable", description: "Contact your instance administrator to create another organization.", label: "Administrator permission required",
  },
  provider: {
    managedLabel: "Instance provider", byokLabel: "Organization provider", managedAvailable: true,
    description: "Use the instance provider or an encrypted provider connection for this organization.",
    unavailable: "Organization provider connections are unavailable. Contact your instance administrator.",
  },
};

export function resolveDashboardSection(edition: DashboardEdition, view: unknown): DashboardSection {
  return edition.sections.find(item => item.id === view)?.id ?? "dashboard";
}
