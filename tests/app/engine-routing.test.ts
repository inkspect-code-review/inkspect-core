import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { engineOrigin, engineRoutes } from "../../src/lib/engine-routing";
import { engineRequest, signEngineRequest } from "../../src/lib/engine-client";

test("a trusted routes file updates the running API without an environment reload", () => {
  const directory = mkdtempSync(join(tmpdir(), "inkspect-routes-"));
  const path = join(directory, "routes.json");
  const env = { NODE_ENV: "test", INKSPECT_ENGINE_ROUTES_FILE: path };
  try {
    assert.throws(() => engineRoutes(env), /routing is unavailable/);
    writeFileSync(path, JSON.stringify({ "team:17": "http://127.0.0.1:8082" }));
    assert.equal(engineOrigin("team", 17, env), "http://127.0.0.1:8082");
    writeFileSync(path, JSON.stringify({ "team:18": "http://127.0.0.1:8083" }));
    assert.equal(engineOrigin("team", 17, env), undefined);
    assert.equal(engineOrigin("team", 18, env), "http://127.0.0.1:8083");
    writeFileSync(path, "invalid");
    assert.throws(() => engineRoutes(env), /routing is unavailable/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("operator-owned routing binds tenant and repository and keeps legacy fallback", () => {
  const env = { NODE_ENV: "test", INKSPECT_ENGINE_URL: "http://127.0.0.1:8081", INKSPECT_CHAT_ENGINE_ROUTES: JSON.stringify({ "team:17": "http://127.0.0.1:8082" }), INKSPECT_ENGINE_ROUTES: JSON.stringify({ "team:18": "http://127.0.0.1:8083" }) };
  assert.equal(engineOrigin("team", 17, env), "http://127.0.0.1:8082");
  assert.equal(engineOrigin("team", 18, env), "http://127.0.0.1:8083");
  assert.equal(engineOrigin("other", 18, env), "http://127.0.0.1:8081");
  assert.equal(engineOrigin("team", 0, env), "http://127.0.0.1:8081");
  for (const routes of ["null", "[]", "invalid", JSON.stringify({ "team:18": 5 }), JSON.stringify({ "team:18": "http://external.example" }), JSON.stringify({ "team:18": "http://user:pass@localhost:8082/" }), JSON.stringify({ "team:18": "http://localhost:8082/?token=secret" }), JSON.stringify({ "team:18": "http://localhost:8082/path" })]) assert.throws(() => engineRoutes({ ...env, INKSPECT_ENGINE_ROUTES: routes }), /routing is unavailable/);
});

test("repository routes apply to listing, policy, jobs and mutations without rewriting signed claims", async () => {
  const env = { NODE_ENV: "test", INKSPECT_ENGINE_URL: "http://127.0.0.1:8081", INKSPECT_ENGINE_SECRET: "s".repeat(32), INKSPECT_ENGINE_ROUTES: JSON.stringify({ "team:18": "http://127.0.0.1:8083" }) } as NodeJS.ProcessEnv;
  const claims = { tenant: "team", subject: "member", connection: "second", installation: 55, repository: 18 };
  const paths = ["/github/repositories", "/github/pulls?page=2", "/jobs", "/jobs/J-one/report", "/github/reviews", "/jobs/J-one/cancel", "/repository/index", "/chat/context"];
  for (const path of paths) {
    const body = path === "/github/reviews" ? { number: 1 } : undefined;
    const method = body ? "POST" : "GET";
    let count = 0;
    const fetcher: typeof fetch = async (input, init) => {
      count++;
      assert.equal(String(input), `http://127.0.0.1:8083${path}`);
      const headers = new Headers(init?.headers);
      const decoded = JSON.parse(Buffer.from(headers.get("x-inkspect-claims")!, "base64url").toString());
      assert.deepEqual({ ...decoded, expires: undefined }, { ...claims, expires: undefined });
      assert.equal(headers.get("x-inkspect-signature"), signEngineRequest(method, path, body ? JSON.stringify(body) : "", decoded, env.INKSPECT_ENGINE_SECRET!)["X-Inkspect-Signature"]);
      return Response.json({ error: "Access revoked" }, { status: 403 });
    };
    await assert.rejects(engineRequest(path, method, body, claims, fetcher, env), /Access revoked/);
    assert.equal(count, 1); // Never retry another worker after authorization fails.
  }
});
