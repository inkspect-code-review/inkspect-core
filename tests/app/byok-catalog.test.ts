import assert from "node:assert/strict";
import test from "node:test";
import { byokModels, byokProviders, supportedModel } from "../../src/lib/byok/catalog";

test("shared BYOK catalog satisfies the Rust credential contract and isolates provider selections", () => {
  const identities = new Set<string>();
  for (const model of byokModels) {
    assert.ok(byokProviders.some(provider => provider.id === model.provider));
    assert.match(model.id, /^[A-Za-z0-9._-]{1,100}$/);
    assert.ok(Number.isInteger(model.output_tokens) && model.output_tokens > 0 && model.output_tokens <= 16384);
    assert.ok(model.context_tokens > model.output_tokens);
    const identity = `${model.provider}:${model.id}`;
    assert.ok(!identities.has(identity), "duplicate provider/model selection");
    identities.add(identity);
    assert.equal(supportedModel(model.provider, model.id), model);
    assert.equal(supportedModel("unsupported", model.id), undefined);
    for (const other of byokProviders.filter(provider => provider.id !== model.provider)) {
      assert.equal(supportedModel(other.id, model.id), undefined);
    }
  }
  assert.ok(identities.size > 0);
  assert.equal(supportedModel("openai", "unlisted-model"), undefined);
});
