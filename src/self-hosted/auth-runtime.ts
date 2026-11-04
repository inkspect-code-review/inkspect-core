import { createSelfHostedAuth } from "./auth";
import { applicationPool } from "../lib/application-database";
import { workspacePlugin } from "../lib/workspace";
import { validateAccountLinking } from "../lib/account-linking";

const runtime = globalThis as typeof globalThis & { inkspectSelfHostedAuth?: ReturnType<typeof createSelfHostedAuth> };
export function getSelfHostedAuth() {
  const cached = runtime.inkspectSelfHostedAuth;
  const schema = cached?.options.plugins?.find(plugin => plugin.id === "default-workspace")?.schema;
  if (!cached || cached.options.user?.validateUserInfo !== validateAccountLinking || JSON.stringify(schema) !== JSON.stringify(workspacePlugin().schema)) {
    runtime.inkspectSelfHostedAuth = createSelfHostedAuth(applicationPool());
  }
  return runtime.inkspectSelfHostedAuth!;
}
