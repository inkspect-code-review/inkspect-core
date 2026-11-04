export const loginProviders = [
  { id: "github", name: "GitHub" },
  { id: "google", name: "Google" },
  { id: "microsoft", name: "Microsoft" },
  { id: "apple", name: "Apple" },
] as const;

export type LoginProvider = typeof loginProviders[number]["id"];
export type LinkSource = "settings" | undefined;
export type SignInMethod = {
  id: LoginProvider;
  name: string;
  connected: boolean;
  available: boolean;
};

export function isLoginProvider(value: unknown): value is LoginProvider {
  return typeof value === "string" && loginProviders.some(({ id }) => id === value);
}

export function linkConfirmationPath(provider: LoginProvider, from?: LinkSource) {
  return `/login/link?provider=${provider}${from === "settings" ? "&from=settings" : ""}`;
}

export function linkSignInPath(provider: LoginProvider, from?: LinkSource) {
  return `/login?link=${provider}&confirm=1${from === "settings" ? "&from=settings" : ""}`;
}

export function signInMethodSummary(accounts: readonly { providerId: string }[], availableProviders: readonly string[]): SignInMethod[] {
  const connected = new Set(accounts.map(({ providerId }) => providerId));
  const available = new Set(availableProviders);
  // Only these display fields cross the server/client boundary, never OAuth tokens.
  return loginProviders.map(provider => ({ ...provider, connected: connected.has(provider.id), available: available.has(provider.id) }));
}
