# Recipe guide

Pick the question you need answered, not a platform-specific workflow to copy.
The [coverage matrix](../README.md#recipes-by-feature) records which environments
have actually exercised each recipe. This guide explains how the examples build
on one another; it does not grant new verification status.

The paths below are reading paths, not execution dependencies. Each recipe remains
independently runnable. Start with its opening question, inspect its plan, then use
its own commands and verification notes.

## Author a workflow

[npm pipeline](./node-npm) → [pnpm variant](./node-pnpm) →
[zero-config discovery](./zero-config) → [selected public targets](./exported-actions).

Start with explicit checkout/install/check/build actions. Zero config asks how to
infer those actions; exported actions asks which commands to expose deliberately.
[Developer loop](./developer-loop) combines discovery with
[Vite+ task caching](./vite-plus-cache) for local human/agent feedback. It is a
composition recipe, not another task-inference implementation. For reusable proof,
continue to [commit-bound verification](./verification-evidence): commit, check that
revision, then attach a signed Git note. Working-file feedback is not attestation.

## Source and artifact boundaries

[Source providers](./source-providers) → [R2 source](./r2-source) or
[Artifacts source](./artifacts-source).

These answer where `source.checkout()` gets its inputs. R2 adds digest-pinned private
storage; Artifacts adds commit-pinned input materialization through a host binding.
[Portable artifacts](./portable-artifacts) answers a different question: how does a
build output cross to another workload? Input providers and output publication are
separate recipes even when both use stored bytes.

## Runners and execution tiers

[Local container](./local-container) → [durable Cloudflare workspace](./cloudflare-runner).

[Runner selection](./runner-selection) explains the compute boundary;
[Blacksmith](./blacksmith) applies it to one runner provider without changing actions.
[Dynamic Worker checks](./dynamic-worker-checks) takes the opposite direction:
run a bounded, source-only formatter in an isolate rather than a container.
That verified formatter is not proof that arbitrary untrusted project modules or
the complete Vite+ toolchain can run there.

## Toolchains and container images

[Node version](./node-version) → [Mise runtimes](./mise-toolchain) →
[system package](./system-package).

[Cloudflare toolchain](./cloudflare-toolchain) applies runtime installation to the
hosted runner. [Custom runner image](./custom-runner-image) instead bakes tools into
the outer workspace image. [Custom container image](./custom-container-image) builds
the project's output image; [Docker-in-Docker](./docker-in-docker) runs a user's
Dockerfile inside a Sandbox. Those are three distinct image boundaries, not three
names for the same feature. Consult the matrix before assuming hosted coverage.

## Control flow and recovery

[Conditional deploy](./conditional-deploy) → [deployment hooks](./deploy-hook).
[Optional checks](./optional-checks) → [snapshot fanout](./snapshot-fanout).
[Execution policy](./execution-policy) → [fail-once retry](./retry) →
[rollback compensation](./rollback-compensation).

Each branch answers one question: inspectable routing, required/advisory checks,
isolated parallel workspaces, policy lowering, observable retries, or recovery after
exhaustion. Retry is deliberately tiny; compensation adds state reversal rather
than hiding it inside that retry demonstration.

## Caching, reruns, and verification

[Package downloads](./package-manager-cache) →
[Vite+ tasks](./vite-plus-cache) or [Turborepo tasks](./turborepo-cache) →
[cache policy](./cache-policy).

Downloads avoid fetching bytes again; task caches validate inputs/outputs; workspace
checkpoints preserve action lineage. None is automatically a signed assertion.
[Verification evidence](./verification-evidence) adds trusted, exact-commit check
reuse. [Dependency-aware reruns](./dependency-aware-reruns) selects affected work;
[immutable attempts](./immutable-attempts) preserves rerun history. Read the latter
after snapshot fanout and rerun selection, not as a replacement cache mechanism.

## Secrets and outbound authentication

[Secure secrets](./secure-secrets) → [host-authenticated outbound requests](./secret-outbound).

The first defines the secret capability and redaction boundary. The second shows
how a container requests an authenticated operation without receiving the credential.
Neither recipe is permission to place host secrets into a project environment.

## Hosted CI, notifications, and approvals

[GitHub-source Cloudflare CI](./github-cloudflare-ci) →
[durable release approval](./cloudflare-hitl-release).

These are intentional integration recipes: portable actions plus event/reporting
adapters, followed by one updated notification card and a durable approval wait.
[GitHub protected-environment approval](./hitl-deploy) is the platform comparison.
Remote dispatch follows the configured service workflow, not an arbitrary uploaded
local module. The remote and Slack rows describe different entrypoints of the same
hosted integration; Discord remains a separate unverified destination.

Deployable services, credentials, Access, and webhook setup belong under
[`apps/effect-ci`](../apps/effect-ci/README.md), not in an example's fixture.
Ordinary CI remains quiet; notification testing is opt-in, not added to every recipe.

## Deployment and progressive release

[Ordered deploy](./ordered-deploy) → [migration before deploy](./d1-migration) →
[strict health-mediated release](./health-mediated-release) →
[bounded human review](./health-mediated-approval).

Ordering and migration recipes use their documented fixtures/dry runs; they do not
prove a real production release. The strict health gate retries uncertainty and
rolls back on regression or exhaustion. The separate review recipe adds explicit
risk acceptance for uncertain/near-margin snapshots, not a regression override.
The hosted app's timer/Progress/emergency policy is another explicitly documented
composition, not a silent change to either standalone gate.

HTTP labs, native WOBS regression evidence, human approval, production commitment,
and complete four-phase WOBS success are different claims. Use the recipe and app
verification notes to distinguish them; a chart alone proves none of those claims.

## Diagnosis and repair

Repair proposals and observability-triggered healing are roadmap recipes in the
matrix, not runnable examples yet. They should build on event routing, public
targets, dependency-aware reruns, and commit-bound evidence rather than introducing
a second execution engine.

## Adding a recipe

- Open with one question. Keep actions needed to answer it; do not add unrelated demos.
- Link the simpler ingredient and name the one new capability or policy this adds.
- Label deliberate compositions as integrations; keep credentials and setup in apps.
- Keep similar boundaries explicit: source/output, runner/project image,
  cache/checkpoint/evidence, strict health/risk acceptance.
- Record actual execution evidence per environment. Local tests, a generated plan,
  and administrative event replay cannot substitute for a hosted or human E2E run.
- Add a matrix row in the appropriate group. Leave unverified environments 🔜.
