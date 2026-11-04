import { NextRequest, NextResponse } from "next/server";
import type { Auth } from "./github";
import { readAuthEnvironment } from "./auth-config";
import { consumeSetupState, createSetupState, githubConfig, saveConnection, setupStateCookie, stateCookie, verifyInstallation, workspaceAdmin, type GitHubConnection } from "./github";
import { logGitHubFailure } from "./github-diagnostics";

function authorizeURL(config: NonNullable<ReturnType<typeof githubConfig>>, baseURL: string, state: string) {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: `${baseURL}/api/github/callback`, state }).toString();
  return url.toString();
}

function stateResponse(url: string, state: string, baseURL: string) {
  const response = NextResponse.redirect(url, 303);
  response.cookies.set(setupStateCookie(state), state, { httpOnly: true, secure: baseURL.startsWith("https:"), sameSite: "lax", path: "/api/github", maxAge: 900 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function clearAttemptCookie(response: NextResponse, request: NextRequest) {
  const state = request.nextUrl.searchParams.get("state");
  if (!state || !/^[a-f0-9]{64}$/.test(state)) return response;
  const name = setupStateCookie(state);
  if (request.cookies.has(name)) response.cookies.set(name, "", { path: "/api/github", maxAge: 0 });
  // Finish attempts that were started before the per-attempt cookie rollout.
  // A stale callback must never erase another tab's pending attempt.
  if (request.cookies.get(stateCookie)?.value === state) response.cookies.set(stateCookie, "", { path: "/api/github", maxAge: 0 });
  return response;
}
export async function startGitHub(request: NextRequest, getAuth: () => Auth) {
  const { baseURL } = readAuthEnvironment();
  if (request.headers.get("origin") !== baseURL) return new Response(null, { status: 403 });
  let returnTo: "integrations" | "reviews" | undefined;
  try {
    const form = await request.formData();
    const destination = form.get("returnTo");
    returnTo = destination === "integrations" || destination === "reviews" ? destination : undefined;
    const auth = getAuth();
    const access = await workspaceAdmin(auth, request.headers);
    if (form.has("organizationId") && form.get("organizationId") !== access.organizationId) throw new Error("workspace-changed");
    const config = githubConfig();
    if (!config) throw new Error("not-configured");
    const connectionId = form.get("connectionId");
    if (connectionId) {
      if (typeof connectionId !== "string") throw new Error("invalid-connection");
      const connection = await (await auth.$context).adapter.findOne<GitHubConnection>({ model: "githubConnection", where: [{ field: "id", value: connectionId }, { field: "organizationId", value: access.organizationId }] });
      if (!connection) throw new Error("invalid-connection");
      const state = await createSetupState(auth, { ...access, returnTo, installationId: connection.installationId });
      return stateResponse(authorizeURL(config, baseURL, state), state, baseURL);
    }
    const state = await createSetupState(auth, { ...access, returnTo });
    return stateResponse(`https://github.com/apps/${config.slug}/installations/new?state=${state}`, state, baseURL);
  } catch (error) {
    const reason = logGitHubFailure("start", error);
    return NextResponse.redirect(`${baseURL}/${returnTo ? `dashboard?view=${returnTo}&` : "onboarding?"}error=${reason}`, 303);
  }
}
export async function finishGitHub(request: NextRequest, stage: "setup" | "callback", getAuth: () => Auth) {
  const { baseURL } = readAuthEnvironment();
  let returnTo: "integrations" | "reviews" | undefined = "integrations";
  try {
    const auth = getAuth();
    const config = githubConfig();
    if (!config) throw new Error("not-configured");
    const params = request.nextUrl.searchParams;
    if (stage === "setup" && !params.has("state")) {
      // GitHub can redirect here after Manage access without an Inkspect
      // installation state. Only refresh an installation already bound to
      // this workspace, and still require the full user-token verification.
      const access = await workspaceAdmin(auth, request.headers);
      if (params.get("setup_action") === "request") throw new Error("installation-pending");
      const installationId = params.get("installation_id");
      const connection = installationId && /^[1-9]\d*$/.test(installationId)
        ? await (await auth.$context).adapter.findOne<GitHubConnection>({ model: "githubConnection", where: [{ field: "installationId", value: installationId }, { field: "organizationId", value: access.organizationId }] })
        : null;
      // Unsolicited new installations must be connected explicitly.
      if (!connection) return NextResponse.redirect(`${baseURL}/dashboard?view=integrations`, 303);
      const state = await createSetupState(auth, { ...access, returnTo, installationId: connection.installationId });
      return stateResponse(authorizeURL(config, baseURL, state), state, baseURL);
    }
    const incomingState = params.get("state");
    const cookie = incomingState && /^[a-f0-9]{64}$/.test(incomingState) ? request.cookies.get(setupStateCookie(incomingState))?.value : undefined;
    const data = await consumeSetupState(auth, incomingState, cookie ?? request.cookies.get(stateCookie)?.value, request.headers);
    returnTo = data.returnTo;
    if (stage === "setup") {
      const installationId = params.get("installation_id");
      if (params.get("setup_action") === "request") throw new Error("installation-pending");
      if (!installationId || !/^\d+$/.test(installationId)) throw new Error("setup-skipped");
      const state = await createSetupState(auth, { ...data, installationId });
      return clearAttemptCookie(stateResponse(authorizeURL(config, baseURL, state), state, baseURL), request);
    }
    const code = params.get("code");
    if (!data.installationId) throw new Error("setup-skipped");
    if (!code || params.has("error")) throw new Error("authorization-failed");
    const connection = await verifyInstallation(config, code, data.installationId, `${baseURL}/api/github/callback`);
    // Membership may have changed while GitHub was responding.
    await workspaceAdmin(auth, request.headers, data.organizationId);
    await saveConnection(auth, data.organizationId, connection, data.userId);
    await auth.api.setActiveOrganization({ headers: request.headers, body: { organizationId: data.organizationId } });
    const response = NextResponse.redirect(`${baseURL}/dashboard?view=${returnTo ?? "repositories"}&connected=1`, 303);
    return clearAttemptCookie(response, request);
  } catch (error) {
    const reason = logGitHubFailure(stage, error);
    const response = NextResponse.redirect(`${baseURL}/${returnTo ? `dashboard?view=${returnTo}&` : "onboarding?"}error=${reason}`, 303);
    return clearAttemptCookie(response, request);
  }
}
