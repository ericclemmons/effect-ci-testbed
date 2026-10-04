# Select the project's Node.js version

> How do I run CI with the exact Node.js version declared by the project?

```mermaid
flowchart LR
  step_checkout["checkout"]
  step_install_node["install node"]
  step_verify_node["verify node"]
  step_checkout --> step_install_node
  step_install_node --> step_verify_node
```

---

The project declares `22.20.0` in [`.node-version`](./.node-version). The action asks
for the workspace-bound Node capability without naming the tool that installs it:

```ts
const node = yield* CI.Toolchain.Node(workspace)

return yield* node.install()
```

`CI.Toolchain.Node` also recognizes `.nvmrc` and an exact
`package.json#devEngines.runtime` declaration. It intentionally ignores
`package.json#engines.node`, which describes compatibility rather than the version CI
should select.

Compare:

- [plain GitHub Actions using `actions/setup-node`](./.github/workflows/github.yml)
- [Effect CI on GitHub](./.github/workflows/effect-on-github.yml)
- [the portable actions](./.cloudflare/ci/actions.ts)
- [the workflow and local runner](./.cloudflare/ci/workflow.ts)

With Docker running:

```sh
pnpm cf-ci --workflow examples/node-version/.cloudflare/ci/workflow.ts
```

The current local runner provides Mise as the Node capability's interpreter. The
workflow depends on `CI.Toolchain.Node`, so another runner can satisfy the same
capability with its native tool cache without changing the actions. The GitHub runner
uses `.node-version` as its cache input and persists `.effect-ci/cache/mise`; other
runners can provide an equivalent policy without changing the workflow.
