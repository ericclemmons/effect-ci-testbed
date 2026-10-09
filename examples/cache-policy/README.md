# Customize or disable a reusable cache

> How do I customize a runner's cache without coupling the workflow to its storage?

```mermaid
flowchart LR
  step_checkout["checkout"]
  step_build["build"]
  step_verify["verify"]
  step_checkout --> step_build
  step_build --> step_verify
```

---

The workflow contains only the dependency graph. The runner layer owns cache behavior:

```ts
Cloudflare.workflowEntrypoint(workflow, {
  cache: {
    key: "custom-build-cache",
    keyFiles: ["examples/cache-policy/app/src/input.txt"],
    paths: ["examples/cache-policy/app/.cache/build"],
  },
  root: "examples/cache-policy",
})
```

The GitHub adapter expresses the same policy as inputs to its reusable workflow and
translates it to `actions/cache`. The Cloudflare adapter owns the corresponding
snapshot-backed implementation. It fingerprints the declared key files from the
requested source before restoring a cache, then keeps only the declared cache paths
while checking out that source. Repository, runtime, and paths also scope the key.
Passing `cache: false` disables cache behavior for a runner. Local execution naturally
reuses the directory already in the working tree.

This distinction is intentional: actions describe work and dependencies; the supplied
runner layer decides where reusable bytes live, how keys are scoped, and how long they
are retained.

The fixture is intentionally dependency-free: `build.ts` reads one input, reuses or
creates one cached output, and `build.test.ts` verifies the result with Node's built-in
test runner. There is no nested package installation or JavaScript runtime shim.

Compare:

- [plain GitHub Actions with explicit `actions/cache`](./.github/workflows/github.yml)
- [Effect CI on GitHub](./.github/workflows/effect-on-github.yml), where the reusable
  runner receives the policy
- [the portable workflow](./.cloudflare/ci/workflow.ts)
- [the deployed Cloudflare runner layer](../../apps/example-runner/src/worker.ts)

Run it twice locally to see a miss followed by a hit:

```sh
pnpm cf-ci --workflow examples/cache-policy/.cloudflare/ci/workflow.ts
pnpm cf-ci --workflow examples/cache-policy/.cloudflare/ci/workflow.ts
```

Cache retention remains runner policy. GitHub configures it at repository or
organization level rather than per `actions/cache` entry, so Effect CI does not expose
a misleading per-workflow retention option.

## Hosted evidence

Native `effect-ci-example-cache-policy` instances on October 9, 2026:

- `coverage-cache-inputs-cold-20261009-2`: cache miss at source `b7c510ed661c1c221072849ba1b1dd93308e702a`.
- `coverage-cache-inputs-warm-20261009-1`: a separate instance restored the same input identity and reported a cache hit.
- `coverage-cache-inputs-changed-20261009-1`: source `e8a0af66921525c4ca6b8957e98d881c75dcdf89` changed the input; identity changed, restoration missed, and output matched the new source.

All three completed with real snapshot restoration and command execution. The earlier
`cold-20261009-1` attempt used an unfetchable abbreviated Git ref and is not proof.
