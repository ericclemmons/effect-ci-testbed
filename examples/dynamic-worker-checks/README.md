# Run source checks in a Worker isolate

> How do I format-check source without paying to execute the formatter inside a container?

```mermaid
flowchart LR
  step_checkout["checkout"]
  step_format_source["format source"]
  step_checkout --> step_format_source
```

---

The action reads source through `CI.Workspace` and calls a portable source tool:

```ts
const source = yield* workspace.readFile("app/src/index.ts")
const formatted = yield* Tools.format({ files: { "app/src/index.ts": source }, options: { semi: false } })
```

The default service runs Prettier locally or on a GitHub runner. The hosted runner
provides an Effect service that executes the same operation through WorkerLoader in
a separate Dynamic Worker. Its outbound network is disabled, it receives no secrets
or filesystem bindings, and its CPU budget is bounded. This is not execution in the
parent Workflow Worker.

This proves a source-in/result-out execution tier, not arbitrary project execution.
Oxlint, Oxfmt, and Vitest can use the same path when they expose Worker-compatible
JavaScript or Wasm APIs. Arbitrary project modules, native executables, and Vite+
toolchain compatibility remain separate work; this example runs a pinned formatter
against untrusted source data.

The [hosted example runner](../../apps/example-runner) imports this workflow unchanged.
Instance `coverage-dynamic-formatter-20261009-1` completed both actions at immutable
source `b7c510ed661c1c221072849ba1b1dd93308e702a`. The native Workflow
`effect-ci-example-dynamic-formatter` recorded only two steps: GitHub source retrieval
and formatter RPC, whose result reports `runtime: "dynamic-worker"`. This path has no
Container checkout, commands, or snapshots. The earlier parent-Worker formatter proof
is preserved as historical evidence.
Platform configuration belongs to that app rather than this consumer example.

Compare the conventional [GitHub Actions workflow](./.github/workflows/github.yml) with
the portable [actions](./.cloudflare/ci/actions.ts) and
[workflow](./.cloudflare/ci/workflow.ts).
