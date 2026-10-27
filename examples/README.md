# Examples

Find the problem you want to solve. Each example has a workflow and instructions
for trying it. Start with [npm](./node-npm), [pnpm](./node-pnpm), or the
[demo app](./demo).

Install dependencies once at the repository root with `pnpm install`. Commands
in the recipes run from that root unless they say otherwise.

## Write less CI

- [Discover checks automatically](./zero-config)
- [Run a single check](./exported-actions)
- [Approve safe changes so authors can self-merge](./small-change)
- [Deploy only when needed](./conditional-deploy)
- [Deploy only changed build output](./deploy-changed-output)

## Run the same work elsewhere

- [Local files or Git](./source-providers), [GitLab](./gitlab-source),
  [R2](./r2-source), [Cloudflare Artifacts](./artifacts-source), or
  [Durable Object storage](./durable-object-source)
- [Local containers](./local-container), [Cloudflare](./cloudflare-runner),
  [GitHub CI on Cloudflare](./github-cloudflare-ci), [runner selection](./runner-selection),
  or [Blacksmith](./blacksmith)
- [Format in an isolate](./dynamic-worker-checks) or
  [test project HTTP behavior in an isolate](./dynamic-project-checks)
- [Publish static assets](./static-assets-source) or
  [build and serve a containerless site](./containerless-site)

## Prepare tools

- [Node version](./node-version), [Mise runtimes](./mise-toolchain),
  [system packages](./system-package), or [Python on Cloudflare](./cloudflare-toolchain)
- [Customize the runner image](./custom-runner-image)
- [Build a project container image](./custom-container-image)
- [Run Docker inside CI](./docker-in-docker)

## Save time

- [Package downloads](./package-manager-cache), [Vite+ tasks](./vite-plus-cache),
  [Turborepo tasks](./turborepo-cache), or [custom cache policy](./cache-policy)
- [Reuse verified checks](./verification-evidence)
- [Rerun affected checks](./dependency-aware-reruns) and
  [keep previous attempts](./immutable-attempts)
- [Run every matrix combination](./matrix), [split tests](./test-splitting), or
  [balance shards using recorded timings](./timing-aware-splitting)
- [Run isolated parallel checks](./snapshot-fanout)
- [Share build artifacts](./portable-artifacts)

## Control failures and releases

- [Required and optional checks](./optional-checks)
- [Retries](./retry), [timeouts](./execution-policy), and [rollback](./rollback-compensation)
- [Deployment hooks](./deploy-hook), [ordered deployments](./ordered-deploy),
  and [D1 migrations](./d1-migration)
- [GitHub approval](./hitl-deploy) or [Slack approval](./cloudflare-hitl-release)
- [Owned PR previews and cleanup](./pull-request-preview)
- [Release from verified local checks](./release-flywheel)
- [Health-gated rollout](./health-mediated-release) or
  [human review of uncertain health](./health-mediated-approval)
- [Model-assisted repair proposals](./flue-repair)

## Keep credentials out of workloads

- [Secret requirements and redaction](./secure-secrets)
- [Host-authenticated outbound requests](./secret-outbound)
- [Wrangler OIDC deployment](./oidc-wrangler) and [cf OIDC deployment](./oidc-cf)

Hosted credentials and service setup live in the [host guide](../apps/effect-ci/README.md).
