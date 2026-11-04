# Execution evidence

## Recipes by feature

Choose a group by the job you need to solve. Within each group, simpler ingredients
come before recipes that compose them. The [recipe guide](./README.md)
provides suggested learning paths and explains the boundaries between similar examples.

Rows marked for conventional GitHub Actions include comparison YAML alongside the
portable Effect CI version. ✅ means end-to-end execution in that actual environment;
local `cf dev` counts as Local, not Cloudflare. 🔜 means unverified roadmap coverage,
not necessarily missing code; — means the execution model is irrelevant. Moving a
recipe into a group does not change its verification status.

`· containerless` is a capability label in the **Effect CI Cloudflare** column,
not another execution environment. `✅ · containerless` means the entire recorded
recipe ran without a Container; `🔜 · containerless` is a planned containerless
path, not verified support. An unlabeled cell is not a claim that a container is
required. Source ingestion, checks/builds, and deployment must each be classified;
a DO-backed source ingredient alone does not make the downstream pipeline containerless.

### Author a workflow

Start with a conventional pipeline, then choose explicit actions or task discovery.

| Recipe | GitHub Actions | Effect CI Local | Effect CI GitHub | Effect CI Cloudflare |
| --- | :---: | :---: | :---: | :---: |
| [Run CI with npm](./node-npm) | ✅ | ✅ | ✅ | ✅ |
| [Run CI with pnpm](./node-pnpm) | ✅ | ✅ | ✅ | ✅ |
| [Discover actions automatically](./zero-config) | ✅ | ✅ | ✅ | ✅ |
| [Run a single check from the CLI](./exported-actions) | ✅ | ✅ | ✅ | ✅ |
| [Check changes before pushing](./demo) | ✅ | ✅ | ✅ | ✅ |

### Checkout and build artifacts

Change where inputs come from without changing actions; publish outputs separately.

| Recipe | GitHub Actions | Effect CI Local | Effect CI GitHub | Effect CI Cloudflare |
| --- | :---: | :---: | :---: | :---: |
| [Checkout from local files or Git](./source-providers) | — | ✅ | — | — |
| [Checkout from GitLab](./gitlab-source) | — | ✅ | ✅ | ✅ |
| [Checkout from R2](./r2-source) | 🔜 | ✅ | ✅ | ✅ |
| [Checkout from Cloudflare Artifacts](./artifacts-source) | — | ✅ | ✅ | ✅ |
| [Checkout from a Durable Object](./durable-object-source) | 🔜 | ✅ | ✅ | ✅ |
| [Share build artifacts between jobs](./portable-artifacts) | ✅ | ✅ | ✅ | ✅ |

### Runners and execution tiers

Choose where the same program runs, from local containers to durable Workflows and isolates.

| Recipe | GitHub Actions | Effect CI Local | Effect CI GitHub | Effect CI Cloudflare |
| --- | :---: | :---: | :---: | :---: |
| [Run CI in a local container](./local-container) | ✅ | ✅ | ✅ | — |
| [Resume CI steps on Cloudflare](./cloudflare-runner) | ✅ | ✅ | ✅ | ✅ |
| [Choose where CI runs](./runner-selection) | ✅ | ✅ | ✅ | — |
| [Run CI on Blacksmith](./blacksmith) | 🔜 | ✅ | 🔜 | — |
| [Format code without a container](./dynamic-worker-checks) | ✅ | ✅ | ✅ | ✅ · containerless |
| [Test untrusted code without a container](./dynamic-project-checks) | — | ✅ | — | ✅ · containerless |

### Toolchains and container images

Select runtimes and OS tools before adding a custom image. A runner image is not a project image.

| Recipe | GitHub Actions | Effect CI Local | Effect CI GitHub | Effect CI Cloudflare |
| --- | :---: | :---: | :---: | :---: |
| [Choose a Node.js version](./node-version) | ✅ | ✅ | ✅ | ✅ |
| [Install runtimes with Mise](./mise-toolchain) | ✅ | ✅ | ✅ | ✅ |
| [Install system tools](./system-package) | ✅ | ✅ | ✅ | ✅ |
| [Install Python on Cloudflare](./cloudflare-toolchain) | ✅ | ✅ | ✅ | ✅ |
| [Customize the CI container](./custom-runner-image) | — | ✅ | — | ✅ |
| [Build and run Docker in CI](./docker-in-docker) | — | 🔜 | — | 🔜 |
| [Build and publish a container image](./custom-container-image) | ✅ | ✅ | ✅ | 🔜 |

### Control flow and recovery

Add inspectable routing, parallel checks, retry policy, and compensation one at a time.

| Recipe | GitHub Actions | Effect CI Local | Effect CI GitHub | Effect CI Cloudflare |
| --- | :---: | :---: | :---: | :---: |
| [Deploy only on matching branches or events](./conditional-deploy) | ✅ | ✅ | ✅ | ✅ |
| [Self-merge safe changes](./small-change) | — | ✅ | 🔜 | 🔜 |
| [Deploy only changed build output](./deploy-changed-output) | 🔜 | ✅ | — | 🔜 |
| [Run a group of actions only when a condition matches](../packages/ci/WORKFLOW.md#when) | 🔜 | 🔜 | 🔜 | 🔜 |
| [Trigger CI from a deployment hook](./deploy-hook) | ✅ | ✅ | ✅ | ✅ |
| [Run required and optional checks](./optional-checks) | ✅ | ✅ | ✅ | ✅ |
| [Run every combination in a matrix](./matrix) | ✅ | ✅ | ✅ | ✅ |
| [Split tests across parallel jobs](./test-splitting) | ✅ | ✅ | ✅ | ✅ |
| [Balance test shards using recorded timings](./timing-aware-splitting) | ✅ | ✅ | ✅ | ✅ |
| [Run checks in parallel from one workspace](./snapshot-fanout) | ✅ | ✅ | ✅ | ✅ |
| [Distribute a native Turbo task graph](./turbo-distributed) | — | ✅ | 🔜 | 🔜 |
| [Set retry and timeout limits](./execution-policy) | ✅ | ✅ | ✅ | ✅ |
| [Retry a flaky test](./retry) | — | ✅ | ✅ | ✅ |
| [Roll back after a failed action](./rollback-compensation) | ✅ | ✅ | ✅ | ✅ |

### Caching, reruns, and verification

Keep download caches, task caches, workspace checkpoints, and signed commit evidence distinct.

| Recipe | GitHub Actions | Effect CI Local | Effect CI GitHub | Effect CI Cloudflare |
| --- | :---: | :---: | :---: | :---: |
| [Cache dependency downloads](./package-manager-cache) | ✅ | ✅ | ✅ | ✅ |
| [Cache tasks with Vite+](./vite-plus-cache) | ✅ | ✅ | ✅ | ✅ |
| [Cache tasks with Turborepo](./turborepo-cache) | ✅ | ✅ | ✅ | ✅ |
| [Customize or disable caching](./cache-policy) | ✅ | ✅ | ✅ | ✅ |
| [Reuse verified checks for a commit](./verification-evidence) | 🔜 | ✅ | ✅ | 🔜 |
| [Rerun only affected checks](./dependency-aware-reruns) | 🔜 | ✅ | 🔜 | 🔜 |
| [Keep rerun history and reuse passed steps](./immutable-attempts) | 🔜 | ✅ | 🔜 | 🔜 |

### Secrets and outbound authentication

Keep credentials outside workspace containers, including authenticated outbound requests.

| Recipe | GitHub Actions | Effect CI Local | Effect CI GitHub | Effect CI Cloudflare |
| --- | :---: | :---: | :---: | :---: |
| [Use secrets without exposing them to containers](./secure-secrets) | ✅ | ✅ | ✅ | ✅ |
| [Call authenticated APIs without exposing credentials](./secret-outbound) | — | 🔜 | — | ✅ |
| [Deploy with Wrangler using short-lived credentials](./oidc-wrangler) | ✅ | — | — | — |
| [Deploy with cf using short-lived credentials](./oidc-cf) | ✅ | — | — | — |

### Hosted CI, notifications, and approvals

Integration recipes compose the earlier ingredients. Notification channels are not separate build pipelines.

| Recipe | GitHub Actions | Effect CI Local | Effect CI GitHub | Effect CI Cloudflare |
| --- | :---: | :---: | :---: | :---: |
| [Run GitHub CI on Cloudflare](./github-cloudflare-ci) ([deploy service](../apps/effect-ci)) | — | — | — | ✅ |
| [Run CI remotely from the CLI](./demo#7-enroll-oidc-and-run-on-a-host) | — | — | — | ✅ |
| [Release from verified local checks](./release-flywheel) | — | ✅ | — | ✅ |
| [Approve a deployment in GitHub](./hitl-deploy) | ✅ | ✅ | ✅ | 🔜 |
| [Approve a release in Slack](./cloudflare-hitl-release) | — | — | — | ✅ |
| [Request release approval in Discord](../apps/effect-ci/README.md#discord--slack-notifications-and-hitl) | — | — | — | 🔜 |

### Deployment and progressive release

Start with ordering and migrations, then study health gates and opt-in human review.

| Recipe | GitHub Actions | Effect CI Local | Effect CI GitHub | Effect CI Cloudflare |
| --- | :---: | :---: | :---: | :---: |
| Deploy an app to Cloudflare Workers | 🔜 | 🔜 | 🔜 | 🔜 |
| [Build or publish static files without a container](./static-assets-source) | — | 🔜 | — | ✅ · containerless |
| [Build and serve a static site without a container](./containerless-site) | — | 🔜 | — | ✅ · containerless |
| [Deploy apps in dependency order](./ordered-deploy) | ✅ | ✅ | ✅ | 🔜 |
| [Migrate D1 before deploying a Worker](./d1-migration) | 🔜 | ✅ | 🔜 | 🔜 |
| [Recover from a deploy failure after migration](./d1-migration#rollback-is-not-filesystem-rewind) | 🔜 | ✅ | 🔜 | 🔜 |
| [Roll out a Worker with health checks](./health-mediated-release) | 🔜 | 🔜 | 🔜 | 🔜 |
| [Review a rollout when health is uncertain](./health-mediated-approval) | — | 🔜 | — | 🔜 |
| Deploy monorepo apps in dependency order | 🔜 | 🔜 | 🔜 | 🔜 |
| Manage multiple Workers and their settings as code | 🔜 | 🔜 | 🔜 | 🔜 |
| Keep a long-running rollout on compatible code | 🔜 | 🔜 | 🔜 | 🔜 |
| Create and clean up PR preview deployments | 🔜 | 🔜 | 🔜 | 🔜 |

### Diagnosis and repair

Inspect an existing verified Flue repair, then distinguish it from automatic healing.

| Recipe | GitHub Actions | Effect CI Local | Effect CI GitHub | Effect CI Cloudflare |
| --- | :---: | :---: | :---: | :---: |
| [Inspect a verified Flue repair proposal](./flue-repair) | — | — | — | ✅ |
| Repair, verify, and propose a fix for a failed action | 🔜 | 🔜 | 🔜 | 🔜 |
| Route a Cloudflare observability issue into a self-healing workflow | — | 🔜 | — | 🔜 |

## Evidence boundaries

- The demo's Cloudflare cell covers the enrolled hosted program. It does not prove
  arbitrary uploaded workflow execution. [Actual runs](../apps/effect-ci/TRUSTED-REMOTE.md).
- [Artifacts source example](./artifacts-source/README.md)
  includes a private repository-root fixture, revoked upload tokens and anonymous
  Git rejection. It is Artifacts upload/binding proof, not private GitHub remote import.
- Containerless recipes verify bounded formatting, project ESM and static-site
  paths separately. They do not imply full Vite+, native binaries or arbitrary
  lifecycle scripts can run in an isolate. Credentials stay in fixed-target brokers.
- The demo's [HTTP error → verified unmerged PR](../apps/effect-ci/PUBLIC-REPAIR.md)
  is recorded separately from the still-unverified WOBS recipe above. No repair
  is automatically merged or deployed.
- Slack's reviewed release proof is not strict healthy automatic progression.
  Uncertain health needs a decision; rejection or timeout restores the prior allocation.
- Setup guides are not verified one-click installers. Use each app's documented
  Access, App and secret setup; do not deploy the whole repository blindly.
