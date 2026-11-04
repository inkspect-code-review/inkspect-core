const messages = {
  connect: "GitHub couldn’t be connected. Try again from Integrations.",
  repository: "This GitHub installation or repository is already connected to another Inkspect workspace. Open the original workspace or choose another installation.",
  state: "This GitHub connection attempt expired or has already been used. Start a new connection from Integrations in this browser.",
  session: "Your Inkspect session expired. Sign in again, then connect GitHub from Integrations.",
  access: "Only a current workspace owner or admin can connect GitHub.",
  workspace: "Your active workspace changed. Refresh Integrations and try again.",
  configuration: "GitHub connections are not configured. Ask the workspace administrator to check the GitHub App settings.",
  pending: "GitHub is waiting for your organization owner to approve this installation. Retry after it’s approved.",
  setup: "GitHub skipped installation setup. In the GitHub App settings, disable Request user authorization during installation and set the Setup URL to this Inkspect instance’s /api/github/setup address, then try again.",
  callback: "GitHub rejected the callback address. Add this Inkspect instance’s /api/github/callback URL to the GitHub App callback URLs, then try again.",
  credentials: "GitHub rejected the app credentials. Check that the configured Client ID and Client Secret belong to this GitHub App.",
  authorization: "GitHub authorization was cancelled or the authorization code expired. Try again and approve access using the GitHub account that administers the organization.",
  installation: "The selected GitHub account cannot access this installation, or the installation is suspended. Authorize with an account that can administer the selected organization.",
  repositories: "GitHub returned no repositories you can administer. Select at least one repository for the installation and authorize with an account that has admin access to it.",
  unavailable: "GitHub could not verify access. Try again shortly. If the error continues, ask the administrator to check the GitHub connection logs.",
  storage: "The GitHub connection could not be saved. Ask the administrator to check the database migrations and connection logs.",
} as const;

export type GitHubConnectionError = keyof typeof messages;
export function parseGitHubError(value: unknown): GitHubConnectionError | undefined {
  return typeof value === "string" && Object.hasOwn(messages, value) ? value as GitHubConnectionError : undefined;
}
export function githubErrorMessage(reason: GitHubConnectionError) { return messages[reason]; }

export function githubFailureReason(error: unknown): GitHubConnectionError {
  const message = error instanceof Error ? error.message : "";
  const known: Record<string, GitHubConnectionError> = {
    "invalid-state": "state", unauthorized: "session", forbidden: "access", "workspace-changed": "workspace",
    "not-configured": "configuration", "invalid-connection": "workspace", "installation-pending": "pending",
    "setup-skipped": "setup", "redirect_uri_mismatch": "callback", "incorrect_client_credentials": "credentials",
    "authorization-failed": "authorization", "bad_verification_code": "authorization",
    "installation-not-authorized": "installation", "no-admin-repositories": "repositories",
    "github-unavailable": "unavailable", "too-many-repositories": "unavailable",
    "installation-already-connected": "repository", "repository-already-connected": "repository",
  };
  if (Object.hasOwn(known, message)) return known[message];
  if (/^Model "[a-zA-Z]\w*" not found in schema$/.test(message) || /^Field \w+ not found in model \w+$/.test(message)) return "storage";
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^(?:23|42|08)/.test(error.code)) return "storage";
  return "connect";
}
