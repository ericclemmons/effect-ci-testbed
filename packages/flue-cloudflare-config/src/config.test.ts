import assert from "node:assert/strict";
import test from "node:test";
import { generatedFlueWorkerConfig } from "./index.ts";

const host = () => ({
  name: "owned",
  entrypoint: "./placeholder.ts",
  compatibilityDate: "2026-10-07",
  workersDev: false,
  compatibilityFlags: ["nodejs_compat"],
  env: { HOST_VALUE: { type: "text", value: "keep" } },
  exports: { HostStore: { type: "durable-object", storage: "sqlite" } },
});
const generated = () => ({
  main: "virtual:flue/worker",
  compatibility_flags: ["nodejs_compat"],
  durable_objects: {
    bindings: [{ name: "FLUE_OWNED_PROPOSAL_AGENT", class_name: "FlueOwnedProposalAgent" }],
  },
});
test("maps real customizer output and preserves authored resources without mutation", () => {
  const config = host();
  const original = structuredClone(config);
  const customize = generatedFlueWorkerConfig((legacy) => Object.assign(legacy, generated()));
  const output = customize(config as Parameters<typeof customize>[0]);
  assert.deepEqual(config, original);
  assert.deepEqual(output, {
    entrypoint: "virtual:flue/worker",
    compatibilityFlags: ["nodejs_compat"],
    exports: {
      ...config.exports,
      FlueOwnedProposalAgent: { type: "durable-object", storage: "sqlite" },
    },
    env: {
      ...config.env,
      FLUE_OWNED_PROPOSAL_AGENT: {
        type: "durable-object",
        worker: "owned",
        exportName: "FlueOwnedProposalAgent",
      },
    },
  });
});
test("preview no-op keeps already emitted config unchanged", () => {
  const config = host();
  const customize = generatedFlueWorkerConfig(() => {});
  assert.deepEqual(customize(config as Parameters<typeof customize>[0]), {});
});
test("host binding/export conflicts, external redirects, duplicates and unknown legacy fields fail closed", () => {
  const cases = [
    {
      bindings: [
        {
          name: "FLUE_OWNED_PROPOSAL_AGENT",
          class_name: "FlueOwnedProposalAgent",
          script_name: "other",
        },
      ],
    },
    {
      bindings: [
        { name: "FLUE_OWNED_PROPOSAL_AGENT", class_name: "FlueOwnedProposalAgent" },
        { name: "FLUE_OTHER", class_name: "FlueOwnedProposalAgent" },
      ],
    },
    { bindings: [{ name: "__proto__", class_name: "FlueOwnedProposalAgent" }] },
  ];
  for (const durable_objects of cases) {
    const fn = generatedFlueWorkerConfig((legacy) =>
      Object.assign(legacy, { ...generated(), durable_objects }),
    );
    assert.throws(() => fn(host() as Parameters<typeof fn>[0]), /conflicts/);
  }
  for (const extra of [
    { main: "https://untrusted.invalid" },
    { migrations: [] },
    { compatibility_flags: [] },
  ]) {
    const fn = generatedFlueWorkerConfig((legacy) =>
      Object.assign(legacy, { ...generated(), ...extra }),
    );
    assert.throws(() => fn(host() as Parameters<typeof fn>[0]), /conflicts/);
  }
  for (const field of ["env", "exports"] as const) {
    const config = host();
    Object.assign(
      config[field],
      field === "env"
        ? { FLUE_OWNED_PROPOSAL_AGENT: { type: "text", value: "private" } }
        : { FlueOwnedProposalAgent: { type: "durable-object", storage: "sqlite" } },
    );
    const fn = generatedFlueWorkerConfig((legacy) => Object.assign(legacy, generated()));
    assert.throws(() => fn(config as Parameters<typeof fn>[0]), {
      message: "Generated Flue config is incompatible or conflicts with host config",
    });
  }
});
