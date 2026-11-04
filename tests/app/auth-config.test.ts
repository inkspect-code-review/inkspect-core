import assert from "node:assert/strict";
import test from "node:test";
import { readAuthEnvironment, socialProviders } from "../../src/lib/auth-config";
import { authErrorMessage } from "../../src/lib/auth-errors";

const valid = { BETTER_AUTH_SECRET: "a".repeat(40), BETTER_AUTH_URL: "http://localhost:3002", DATABASE_URL: "postgresql://localhost/inkspect_test" };

test("rejects missing secrets and unsafe deployment origins", () => {
  assert.throws(() => readAuthEnvironment({}));
  assert.throws(() => readAuthEnvironment({ ...valid, BETTER_AUTH_SECRET: "short" }));
  for (const origin of ["http://app.inkspect.si", "https://user:password@app.inkspect.si", "https://app.inkspect.si/path", "https://app.inkspect.si?redirect=evil"]) {
    assert.throws(() => readAuthEnvironment({ ...valid, BETTER_AUTH_URL: origin }));
  }
  assert.throws(() => readAuthEnvironment({ ...valid, NODE_ENV: "production" }));
  assert.equal(readAuthEnvironment({ ...valid, NODE_ENV: "production", BETTER_AUTH_URL: "https://app.inkspect.si" }).baseURL, "https://app.inkspect.si");
  assert.equal(readAuthEnvironment(valid).baseURL, "http://localhost:3002");
});

test("only registers providers with complete credentials", () => {
  assert.deepEqual(socialProviders({ GITHUB_CLIENT_ID: "partial" }), {});
  const providers = socialProviders({
    GITHUB_CLIENT_ID: "github", GITHUB_CLIENT_SECRET: "secret",
    GOOGLE_CLIENT_ID: "google", GOOGLE_CLIENT_SECRET: "secret",
    MICROSOFT_CLIENT_ID: "microsoft", MICROSOFT_CLIENT_SECRET: "secret",
    APPLE_CLIENT_ID: "apple", APPLE_CLIENT_SECRET: "jwt",
  });
  assert.deepEqual(Object.keys(providers ?? {}).sort(), ["apple", "github", "google", "microsoft"]);
});

test("callback errors give guidance without rendering arbitrary upstream content", () => {
  assert.match(authErrorMessage("INVALID_TOKEN"), /expired/);
  assert.match(authErrorMessage("account_not_linked"), /original sign-in method/);
  assert.match(authErrorMessage(undefined, 429), /Too many attempts/);
  assert.doesNotMatch(authErrorMessage("secret-from-upstream"), /secret-from-upstream/);
});
