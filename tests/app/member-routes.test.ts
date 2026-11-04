import assert from "node:assert/strict";
import test from "node:test";
import { handleMembers, handleInvitation } from "../../src/lib/member-routes";
import type { Auth } from "../../src/lib/github";
import type { MembershipService } from "../../src/lib/membership-service";

const id = "ef424ede-f2be-4151-9df9-ef48d03209cb";
function fixture(role = "owner", signedIn = true) {
  const calls: unknown[][] = [];
  const invitation = { id, email: "guest@example.com", role: "member", expires_at: new Date() };
  const auth = { options: { baseURL: "https://workspace.example" }, api: { getSession: async () => signedIn ? {
    user: { id: "actor", email: invitation.email, emailVerified: true, ageConfirmedAt: new Date() }, session: { activeOrganizationId: "org" },
  } : null }, $context: Promise.resolve({ adapter: { findOne: async () => ({ role }) } }) } as unknown as Auth;
  const membership: MembershipService = {
    list: async (...args) => { calls.push(["list", ...args]); return [invitation]; },
    invite: async (...args) => { calls.push(["invite", ...args]); return invitation; },
    cancel: async (...args) => { calls.push(["cancel", ...args]); },
    find: async (...args) => { calls.push(["find", ...args]); return invitation; },
    accept: async (...args) => { calls.push(["accept", ...args]); return { organizationId: "org" }; },
  };
  return { auth, membership, calls };
}
function request(body?: object, organization = "org", origin = "https://workspace.example") {
  return new Request(`https://workspace.example/api/members?organizationId=${organization}`, {
    method: body ? "POST" : "GET", headers: { origin, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });
}

test("shared member handler delegates only the verified organization and actor", async () => {
  const { auth, membership, calls } = fixture();
  const body = { action: "invite", email: "guest@example.com", role: "member", organizationId: "forged", userId: "forged" };
  const response = await handleMembers(request(body), auth, membership);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).url, `https://workspace.example/invite?id=${id}`);
  assert.deepEqual(calls, [["invite", "org", "actor", body]]);
  assert.equal((await handleMembers(request({ action: "cancel", id }), auth, membership)).status, 200);
  assert.deepEqual(calls[1], ["cancel", "org", "actor", id]);
});

test("membership implementations are not invoked for unauthorized or stale requests", async () => {
  for (const [role, signedIn, organization, origin, expected] of [
    ["member", true, "org", "https://workspace.example", 403],
    ["owner", false, "org", "https://workspace.example", 401],
    ["owner", true, "other", "https://workspace.example", 409],
    ["owner", true, "org", "https://attacker.example", 403],
  ] as const) {
    const { auth, membership, calls } = fixture(role, signedIn);
    assert.equal((await handleMembers(request({ action: "invite" }, organization, origin), auth, membership)).status, expected);
    assert.deepEqual(calls, []);
  }
});

test("invitation lookup is recipient scoped and acceptance requires same-origin POST", async () => {
  const { auth, membership, calls } = fixture();
  const url = `https://workspace.example/api/invitation?id=${id}`;
  assert.equal((await handleInvitation(new Request(url), auth, membership)).status, 200);
  assert.deepEqual(calls.shift(), ["find", id, "guest@example.com"]);
  assert.equal((await handleInvitation(new Request(url, { method: "POST" }), auth, membership)).status, 403);
  assert.deepEqual(calls, []);
  assert.equal((await handleInvitation(new Request(url, { method: "POST", headers: { origin: "https://workspace.example" } }), auth, membership)).status, 200);
  assert.equal(calls[0][0], "accept");
  assert.equal(calls[0][1], id);
  assert.equal((calls[0][2] as { id: string }).id, "actor");
});
