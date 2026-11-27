export const defaultDashboardTheme = "graphite";

export const dashboardThemes = [
  { id: defaultDashboardTheme, name: "Graphite", description: "Near-black surfaces with cobalt accents." },
  { id: "chatgpt-desktop", name: "Charcoal", description: "Soft charcoal, neutral grays." },
  { id: "landing-light", name: "Porcelain", description: "Cool gray, white surfaces, blue ink." },
  { id: "classic", name: "Dusk", description: "Charcoal with soft purple accents." },
  { id: "landing-dark", name: "Onyx", description: "Black paper, white ink." },
] as const;

export type DashboardTheme = typeof dashboardThemes[number]["id"];
export const themeCookie = "inkspect_dashboard_theme";
/** Returns the saved theme, or undefined when none is saved. */
export function parseTheme(value: string | undefined): DashboardTheme | undefined {
  return dashboardThemes.find((theme) => theme.id === value)?.id;
}
