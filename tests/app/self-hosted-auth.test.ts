import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { getMigrations } from "better-auth/db/migration";
import { createSelfHostedAuth, selfHostedAuthPolicy } from "../../src/self-hosted/auth";

test("self-hosted login and organization creation need no Cloud subscription or billing schema", async () => {
  process.env.BETTER_AUTH_URL = "http://localhost:3002";
  process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("hex");
  process.env.DATABASE_URL = "postgresql://localhost/unused_test_database";
  process.env.INKSPECT_ACCOUNT_ONBOARDING_ENABLED = "false";
  Object.assign(process.env, { NODE_ENV: "test" });
  const database = new DatabaseSync(":memory:");
  let link = "";
  const auth = createSelfHostedAuth(database, async message => { link = message.url; });
  const origin = "http://localhost:3002";
  const post = (path: string, body: object, cookie = "", requestOrigin = origin) => auth.handler(new Request(`${origin}/api/auth${path}`, {
    method: "POST", headers: { origin: requestOrigin, cookie, "content-type": "application/json", "x-real-ip": "192.0.2.44" }, body: JSON.stringify(body),
  }));
  try {
    await (await getMigrations(auth.options)).runMigrations();
    assert.equal((await post("/sign-in/magic-link", { email: "owner@example.com", callbackURL: "/dashboard" })).status, 200);
    const verified = await auth.handler(new Request(link));
    assert.equal(verified.status, 302);
    const cookie = verified.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    const create = await post("/organization/create", { name: "Self-hosted team", slug: "local-team" }, cookie);
    assert.equal(create.status, 200);
    const organization = await create.json();
    assert.ok(organization.id);
    const member = database.prepare('SELECT role FROM member WHERE organizationId = ?').get(organization.id);
    assert.equal(member?.role, "owner");
    assert.equal((await post("/organization/create", { name: "Untrusted", slug: "untrusted" }, cookie, "https://evil.example")).status, 403);
    assert.equal((await post("/organization/create", { name: "Anonymous", slug: "anonymous" })).status, 401);
    // The alternate Better Auth invitation endpoint cannot bypass our membership service.
    const alternate = await post("/organization/invite-member", { email: "guest@example.com", role: "member", organizationId: organization.id }, cookie);
    assert.equal(alternate.status, 403);
    assert.match((await alternate.json()).message, /Create invitations in Members/);
    assert.equal(database.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE 'billing_%'").get()?.n, 0);
    assert.equal(await selfHostedAuthPolicy.canCreateOrganization({ id: "unverified", emailVerified: false }), false);
  } finally { database.close(); }
});
