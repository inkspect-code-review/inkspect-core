import assert from "node:assert/strict";
import test from "node:test";
import { dashboardThemes, defaultDashboardTheme, parseTheme } from "../../src/lib/theme";

test("saved Graphite and previous theme choices are recognized on reload", () => {
  for (const id of ["graphite", "classic", "landing-dark", "landing-light", "chatgpt-desktop"]) {
    assert.equal(parseTheme(id), id);
  }
  assert.equal(parseTheme(undefined), undefined);
  assert.equal(parseTheme("unknown"), undefined);
});

test("Graphite is the default and appears first in Appearance", () => {
  assert.equal(defaultDashboardTheme, "graphite");
  assert.equal(dashboardThemes[0].id, defaultDashboardTheme);
});
