# Examples

Start with [the walkthrough](./demo). The API section explains each API and links to
solutions that use it. Recipes covers broader goals. Entries are alphabetical.

Install dependencies once at the repository root with `pnpm install`. Add the
unpublished CLI to your shell from that root:

```sh
export PATH="$PWD/node_modules/.bin:$PATH"
```

Each example starts with `cd examples/...`. The CLI discovers its workflow there.

[Execution evidence](./COVERAGE.md) distinguishes local examples from verified hosted runs.

## CI.action

[API](../packages/ci/ACTION.md)

- [Exports](./exported-actions)
- [Retries](./retry)
- [Rollback](./rollback-compensation)
- [Timeouts](./execution-policy)

## CI.Approval

[API](../packages/ci/APPROVAL.md)

- [GitHub](./hitl-deploy)
- [Slack](./cloudflare-hitl-release)

## CI.Artifact

[API](../packages/ci/ARTIFACT.md)

- [Between jobs](./portable-artifacts)

## CI.check

[API](../packages/ci/CHECK.md)

- [Reuse](./verification-evidence)

## CI.PackageManager

[API](../packages/ci/PACKAGE-MANAGER.md)

- [Apt](./system-package)
- [npm](./node-npm)
- [pnpm](./node-pnpm)
- [Python](./cloudflare-toolchain)

## CI.Secret

[API](../packages/ci/SECRET.md)

- [Redaction](./secure-secrets)

## CI.Source

[API](../packages/ci/SOURCE.md)

- [Artifacts](./artifacts-source)
- [changed](./conditional-deploy)
- [Durable Objects](./durable-object-source)
- [GitHub](./source-providers)
- [GitLab](./gitlab-source)
- [R2](./r2-source)

## CI.Toolchain

[API](../packages/ci/TOOLCHAIN.md)

- [Mise](./mise-toolchain)
- [Node](./node-version)
- [Turbo](./turbo-distributed)

## CI.workflow

[API](../packages/ci/WORKFLOW.md)

- [Matrix](./matrix)
- [Optional checks](./optional-checks)
- [Parallel checks](./snapshot-fanout)

## CI.Workspace

[API](../packages/ci/WORKSPACE.md)

- [changed](./deploy-changed-output)
- [checkpoint](./workspace)
- [exec](./local-container)

## Recipes

- [Balance test shards](./timing-aware-splitting)
- [Build a container image](./custom-container-image)
- [Build a static site](./containerless-site)
- [Cache package downloads](./package-manager-cache)
- [Cache Turborepo tasks](./turborepo-cache)
- [Cache Vite+ tasks](./vite-plus-cache)
- [Call authenticated APIs](./secret-outbound)
- [Choose a runner](./runner-selection)
- [Customize caching](./cache-policy)
- [Customize the runner image](./custom-runner-image)
- [Deploy in order](./ordered-deploy)
- [Deploy with cf OIDC](./oidc-cf)
- [Deploy with Wrangler OIDC](./oidc-wrangler)
- [Format in an isolate](./dynamic-worker-checks)
- [Keep previous attempts](./immutable-attempts)
- [Migrate D1](./d1-migration)
- [Propose a repair](./flue-repair)
- [Publish static assets](./static-assets-source)
- [Release from local checks](./release-flywheel)
- [Rerun affected checks](./dependency-aware-reruns)
- [Resume on Cloudflare](./cloudflare-runner)
- [Review uncertain health](./health-mediated-approval)
- [Roll out with health checks](./health-mediated-release)
- [Run Docker inside CI](./docker-in-docker)
- [Run existing Turbo CI tasks](./turbo-ci)
- [Run GitHub CI on Cloudflare](./github-cloudflare-ci)
- [Run on Blacksmith](./blacksmith)
- [Self-merge safe changes](./small-change)
- [Split tests](./test-splitting)
- [Test in an isolate](./dynamic-project-checks)
- [Trigger a deployment hook](./deploy-hook)
- [Use existing package scripts](./zero-config)

Hosted credentials and service setup live in the [host guide](../apps/effect-ci/README.md).

The hosted runner discovers project workflows; basic recipes do not need separate
Workers or deployments. From this repository, select a recipe with
`effect-ci run --remote --workflow examples/node-npm/.cloudflare/ci/workflow.ts`.
The runner checks out the pushed commit and runs that project's workflow in its
workspace. It does not upload local edits or import recipes into the host Worker.
See [remote project selection](../packages/cli/README.md#remote-project-selection).
