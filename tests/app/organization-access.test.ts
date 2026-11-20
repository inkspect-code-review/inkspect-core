import assert from "node:assert/strict";
import test from "node:test";
import { organizationAccess } from "../../src/lib/organization-access";
import type { Auth } from "../../src/lib/github";
import { ReviewError } from "../../src/lib/review-access";
import { registerWorkspacePolicy } from "../../src/lib/workspace-policy";

test("application workspace policy runs after membership and does not affect other auth instances", async () => {
  const restricted = fixture("owner").auth;
  const seen: string[] = [];
  registerWorkspacePolicy(restricted, { async assertAccess(id) { seen.push(id); throw new ReviewError(403, "Workspace unavailable"); } });
  await assert.rejects(organizationAccess(request(), restricted), /Workspace unavailable/);
  assert.deepEqual(seen, ["org-1"]);
  assert.equal((await organizationAccess(request(), fixture("owner").auth)).organizationId, "org-1");
});

function fixture(role: string | null = "member", signedIn = true) {
  const lookups: unknown[] = [];
  const auth = {
    options: { baseURL: "https://workspace.example" },
    api: { getSession: async () => signedIn ? {
      user: { id: "user-1", ageConfirmedAt: new Date() }, session: { activeOrganizationId: "org-1" },
    } : null },
    $context: Promise.resolve({ adapter: { findOne: async (query: unknown) => {
      lookups.push(query);
      return role === null ? null : { role };
    } } }),
  } as unknown as Auth;
  return { auth, lookups };
}

const request = (query = "org-1", method = "GET", origin?: string) =>
  new Request(`https://workspace.example/api/members?organizationId=${query}`, {
    method, headers: origin ? { origin } : {},
  });
const status = (expected: number) => (error: unknown) =>
  error instanceof ReviewError && error.status === expected;

test("workspace authorization binds membership to the session user and active organization", async () => {
  const { auth, lookups } = fixture();
  const result = await organizationAccess(request(), auth);
  assert.equal(result.organizationId, "org-1");
  assert.equal(result.canManage, false);
  assert.deepEqual(lookups, [{ model: "member", where: [
    { field: "userId", value: "user-1" }, { field: "organizationId", value: "org-1" },
  ] }]);
});

test("workspace authorization rejects missing sessions, stale selections and removed members", async () => {
  await assert.rejects(organizationAccess(request(), fixture("owner", false).auth), status(401));
  for (const query of ["", "another-org"]) {
    const { auth, lookups } = fixture("owner");
    await assert.rejects(organizationAccess(request(query), auth), status(409));
    assert.deepEqual(lookups, []);
  }
  await assert.rejects(organizationAccess(request(), fixture(null).auth), status(403));
});

test("only explicit owner/admin roles grant management without any payment dependency", async () => {
  for (const role of ["owner", "admin", "member, admin"]) {
    assert.equal((await organizationAccess(request(), fixture(role).auth)).canManage, true);
  }
  for (const role of ["member", "", "administrator", "owner-other"]) {
    assert.equal((await organizationAccess(request(), fixture(role).auth)).canManage, false);
  }
});

test("workspace mutations require the configured origin even for owners", async () => {
  for (const method of ["POST", "PATCH", "DELETE"]) {
    for (const origin of [undefined, "https://attacker.example"]) {
      const { auth, lookups } = fixture("owner");
      await assert.rejects(organizationAccess(request("org-1", method, origin), auth), status(403));
      assert.deepEqual(lookups, []);
    }
    assert.equal((await organizationAccess(request("org-1", method, "https://workspace.example"), fixture("owner").auth)).canManage, true);
  }
});
