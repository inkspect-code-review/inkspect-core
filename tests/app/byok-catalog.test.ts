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


test("expanded review models are accepted without enabling non-review models", () => {
  for (const [provider, ids] of Object.entries({
    openai: ["gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-sol", "gpt-5.5", "gpt-5.4-mini"],
    anthropic: ["claude-sonnet-5-5", "claude-fable-5-2", "claude-opus-4-6", "claude-haiku-4-5"],
    google: ["gemini-3.8-flash", "gemini-4-argon", "gemini-4-carbon", "gemini-4-hydrogen", "gemini-3.5-flash-lite"],
  })) for (const id of ids) assert.ok(supportedModel(provider, id), `${provider}/${id}`);
  for (const [provider, id] of [["openai", "gpt-image-2.6-sunburst"], ["anthropic", "claude-mythos-5-2"], ["google", "gemini-3.8-live"], ["google", "gemini-3-pro-image"]]) {
    assert.equal(supportedModel(provider, id), undefined);
  }
});
