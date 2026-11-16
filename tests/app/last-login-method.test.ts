import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { getMigrations } from "better-auth/db/migration";
import { createSelfHostedAuth } from "../../src/self-hosted/auth";
import { lastLoginMethodCookie, loginMethodForPath, parseLoginMethod } from "../../src/lib/login-providers";

const origin = "http://localhost:3002";
const cookies = (response: Response) => response.headers.getSetCookie().map(value => value.split(";")[0]).filter(value => !value.endsWith("=")).join("; ");
const remembered = (response: Response) => response.headers.getSetCookie().find(value => value.startsWith(`${lastLoginMethodCookie}=`));

test("recognizes supported completed sign-in methods only", () => {
  for (const provider of ["github", "google", "microsoft", "apple"]) {
    assert.equal(loginMethodForPath(`/callback/${provider}`), provider);
    assert.equal(loginMethodForPath("/callback/:id", provider), provider);
  }
  assert.equal(loginMethodForPath("/magic-link/verify"), "email");
  assert.equal(loginMethodForPath("/passkey/verify-authentication"), "passkey");
  assert.equal(loginMethodForPath("/sign-in/social", "google"), undefined);
  assert.equal(parseLoginMethod("unknown"), undefined);
});

test("remembers completed sign-in, preserves it on failure/logout and waits for two-factor verification", async () => {
  Object.assign(process.env, { NODE_ENV: "test", BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), DATABASE_URL: "postgresql://localhost/unused", INKSPECT_ACCOUNT_ONBOARDING_ENABLED: "false" });
  const database = new DatabaseSync(":memory:");
  let link = "";
  const auth = createSelfHostedAuth(database, async message => { link = message.url; });
  const post = (path: string, body: object, cookie = "") => auth.handler(new Request(`${origin}/api/auth${path}`, { method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify(body) }));
  const signIn = async () => {
    const requested = await post("/sign-in/magic-link", { email: "badge@example.com", callbackURL: "/dashboard" });
    assert.equal(requested.status, 200);
    assert.equal(remembered(requested), undefined);
    return auth.handler(new Request(link));
  };
  try {
    await (await getMigrations(auth.options)).runMigrations();
    Object.assign((await auth.$context).options.rateLimit!, { enabled: false });
    const signedIn = await signIn();
    assert.match(remembered(signedIn)!, /^inkspect.last-login-method=email;/);
    assert.match(remembered(signedIn)!, /HttpOnly/i);
    assert.match(remembered(signedIn)!, /Max-Age=15552000/);
    const setupResponse = await post("/two-factor/enable", {}, cookies(signedIn));
    assert.equal(setupResponse.status, 200);
    const setup = await setupResponse.json();
    database.prepare('UPDATE user SET twoFactorEnabled = 1').run();
    const signedOut = await post("/sign-out", {}, cookies(signedIn));
    assert.equal(remembered(signedOut), undefined);
    const invalid = await auth.handler(new Request(`${origin}/api/auth/magic-link/verify?token=invalid`));
    assert.equal(remembered(invalid), undefined);
    const cancelled = await auth.handler(new Request(`${origin}/api/auth/callback/github?error=access_denied`));
    assert.equal(remembered(cancelled), undefined);
    const challenge = await signIn();
    assert.match(challenge.headers.get("location")!, /^\/login\/two-factor/);
    assert.equal(remembered(challenge), undefined);
    const rejected = await post("/two-factor/verify-backup-code", { code: "invalid" }, cookies(challenge));
    assert.notEqual(rejected.status, 200);
    assert.equal(remembered(rejected), undefined);
    const verified = await post("/two-factor/verify-backup-code", { code: setup.backupCodes[0] }, cookies(challenge));
    assert.equal(verified.status, 200);
    assert.match(remembered(verified)!, /^inkspect.last-login-method=email;/);
  } finally { database.close(); }
});
