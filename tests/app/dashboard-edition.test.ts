import test from "node:test";
import assert from "node:assert/strict";
import { resolveDashboardSection, selfHostedDashboardEdition } from "../../src/lib/dashboard-edition";

test("unknown sections never become self-hosted routes", () => {
  assert.equal(resolveDashboardSection(selfHostedDashboardEdition, "extension-report"), "dashboard");
  assert.equal(resolveDashboardSection(selfHostedDashboardEdition, "members"), "members");
});

test("applications can register a generic section without changing shared defaults", () => {
  const custom = { ...selfHostedDashboardEdition, sections: [...selfHostedDashboardEdition.sections,
    { id: "extension-report", name: "Report", description: "Application-defined report" }] };
  assert.equal(resolveDashboardSection(custom, "extension-report"), "extension-report");
  assert.equal(resolveDashboardSection(selfHostedDashboardEdition, "extension-report"), "dashboard");
});
