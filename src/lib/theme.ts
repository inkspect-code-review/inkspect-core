export const dashboardThemes = [
  { id: "chatgpt-desktop", name: "Default", description: "Soft charcoal, neutral grays." },
  { id: "landing-light", name: "Landing Light", description: "Cool gray, white surfaces, blue ink." },
  { id: "classic", name: "Classic", description: "Charcoal with soft purple accents." },
  { id: "landing-dark", name: "Landing Dark", description: "Black paper, white ink." },
] as const;

export type DashboardTheme = typeof dashboardThemes[number]["id"];
export const themeCookie = "inkspect_dashboard_theme";
/** Returns the saved theme, or undefined when none is saved and the OS color scheme decides. */
export function parseTheme(value: string | undefined): DashboardTheme | undefined {
  return dashboardThemes.find((theme) => theme.id === value)?.id;
}

// Until someone picks a theme, a dark OS gets Default and a light OS gets Landing Light.
export const systemThemes = { dark: "chatgpt-desktop", light: "landing-light" } as const satisfies Record<"dark" | "light", DashboardTheme>;
export const lightSchemeQuery = "(prefers-color-scheme: light)";
// The server can't see the OS setting, so it renders the dark theme and the root layout
// inlines this at the top of <body> to switch light-OS visitors before the first paint.
export const systemThemeScript = `if(matchMedia(${JSON.stringify(lightSchemeQuery)}).matches)document.body.dataset.dashboardTheme=${JSON.stringify(systemThemes.light)}`;
