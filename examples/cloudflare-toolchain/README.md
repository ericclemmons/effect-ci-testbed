# Install Python at runtime on Cloudflare

> How do I install an additional operating-system tool without creating a project-specific runner image?

```mermaid
flowchart LR
  step_checkout["checkout"]
  step_prepare_python_toolchain["prepare python toolchain"]
  step_build_python_package["build python package"]
  step_checkout --> step_prepare_python_toolchain
  step_prepare_python_toolchain --> step_build_python_package
```

---

## Hosted coverage

The [hosted example runner](../../apps/example-runner) completed
`coverage-python-toolchain-20261008-1` in a real Cloudflare account. It installs
Python and pip with apt, installs the pinned package-build tools, and builds the
Python package across seven native Workflow steps. No project Dockerfile is required.

The shared Effect CI Sandbox 1.0 image supplies Node.js, Git, and `sandbox-shim`. An
ordinary action yields the apt package-manager capability, installs Python at runtime,
and returns the prepared logical workspace:

```ts
export const preparePython = CI.action(
  "prepare python toolchain",
  () => function* () {
    const workspace = yield* checkout()

    const apt = yield* CI.PackageManager.Apt(workspace)
    const prepared = yield* apt.install(["python3", "python3-pip"])

    return yield* prepared.exec(
      "python3 -m pip install --break-system-packages --root-user-action=ignore --no-cache-dir build==1.3.0 hatchling==1.27.0",
    )
  },
)
```

The build action consumes that prepared workspace without knowing whether the runner
kept its Container alive or restored its durable revision:

```ts
export const build = CI.action("build python package", () => function* () {
  const workspace = yield* preparePython()

  return yield* workspace.exec("python3 -m build --no-isolation")
})
```

There is intentionally no project-specific Dockerfile or explicit snapshot plumbing.
The package-owned image supplies the runner contract; commands describe the additional
project toolchain; the Cloudflare runner commits returned workspaces as native
snapshots. Future Containers can materialize that logical revision without repeating
setup. Use a custom runner image instead when the OS layer itself is part of the
project's reproducibility or the packages cannot be installed at runtime.

## Compare GitHub and Effect CI

- [`.github/workflows/github.yml`](./.github/workflows/github.yml) installs the same
  apt and Python packages directly in GitHub Actions YAML.
- [`.github/workflows/effect-on-github.yml`](./.github/workflows/effect-on-github.yml)
  runs the portable [`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts) on a
  GitHub runner.
- [`src/worker.ts`](./src/worker.ts) supplies Cloudflare's Sandbox and durable
  workspace implementation to that same workflow.

`CI.PackageManager.Apt(workspace)` hides the one relevant runner difference: GitHub's
runner installs through `sudo`, while Cloudflare's managed Container runs apt as root.
The consumer action only names the required packages.

Start the Worker with Docker running:

```sh
pnpm dev
```

Then trigger its Workflow from another terminal:

```sh
pnpm exec wrangler workflows trigger effect-ci-cloudflare-toolchain \
  '{"repository":"https://github.com/ericclemmons/effect-ci-testbed.git","revision":"main"}' \
  --local
```

The completed `build python package` step produces a wheel and source archive in the
materialized workspace. Publishing portable artifacts remains separate from durable
workspace revisions.
