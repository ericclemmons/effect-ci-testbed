# Effect CI: the kitchen-sink demo

One Vite app, from existing package scripts to remote CI, reusable results,
GitHub approval, Slack, previews, controlled releases, and repair proposals.
Each chapter adds a capability without replacing the app's tools.

The local chapters run in the copied app below. The hosted chapters describe
the full conference tour: their services exist in the hosted integration, but
are not yet connected end-to-end to this standalone copy. A new repository does
not automatically inherit that integration. AI is off.

## 1. Start the app

Requires Node 24.11+ and pnpm 12.8.1.

```sh
cd $(mktemp -d)
pnpm dlx tiged ericclemmons/effect-ci-testbed/examples/demo demo
cd demo
pnpm install
pnpm dev
```

Open the Vite URL. Stop the server with Ctrl-C.

## 2. Existing scripts become CI

Link the unpublished CLI and SDK from your Effect CI checkout. Replace the paths:

```sh
pnpm link /path/to/effect-ci-testbed/packages/cli /path/to/effect-ci-testbed/packages/ci
git init
git add .
git commit -m "Start the demo"
pnpm exec cf-ci run test build
```

No workflow file required. Discover the available actions and inspect their plan:

```sh
pnpm exec cf-ci list
pnpm exec cf-ci plan --format=mermaid
```

Change `src/message.ts`, then run test and build again. Your package scripts
remain the source of truth.

[Script discovery](../zero-config)

## 3. The same commands for people and agents

An author or agent uses the same workflow, with structured results when useful:

```sh
pnpm exec cf-ci run test build --format=json
```

Structured output does not require a model or a separate agent-only CI path.

## 4. Cache tasks and rerun affected work

Run the build twice and inspect Vite+'s hit/miss output:

```sh
pnpm exec cf-ci run build
pnpm exec cf-ci run build
```

Change `packages/greeting/message.ts` and repeat. The importing app rebuilds,
even though `src/app.ts` did not change. The task runner owns its dependency
graph and cache; Effect CI keeps using the same build command.

There are three different things to reuse: dependency downloads, task output,
and verified CI results. Download caching still performs the locked install;
task caching avoids recomputation; signed results are covered in chapter 9.
Choose cache paths and input keys explicitly, or disable caching for a workload.

[Vite+ caching](../vite-plus-cache) · [Turborepo caching](../turborepo-cache) ·
[Dependency downloads](../package-manager-cache) · [Cache policy](../cache-policy) ·
[Dependency-aware reruns](../dependency-aware-reruns)

## 5. Parallel checks, shared prerequisites

Adopt the supplied workflow when you want more control:

```sh
mkdir -p .cloudflare/ci
cp tutorial/workflow.ts .cloudflare/ci/workflow.ts
git add .cloudflare/ci/workflow.ts
git commit -m "Add CI workflow"
pnpm exec cf-ci run
```

The [workflow](./tutorial/workflow.ts) uses ordinary TypeScript:

```ts
yield * CI.parallel([lint(), test()]);
const workspace = yield * build();
if (yield * workspace.changed("dist/**")) yield * deploy();
```

Actions declare their prerequisites; shared actions run once. Parallel work is
explicit, rather than an automatic reordering of arbitrary JavaScript.
Request an exported action directly when you only need that goal.

[Exported actions](../exported-actions) · [Isolated snapshot fan-out](../snapshot-fanout)

## 6. Source-aware checks

On a branch, commit a README edit and run the workflow. The supplied lint action
can skip it. Commit a change to `packages/greeting/message.ts` and run again:
lint runs, and the app consumes the changed shared package.

```ts
if (yield * source.changed(["**/*.ts", "package.json", "pnpm-lock.yaml"])) {
  yield * workspace.exec("pnpm lint");
}
```

Missing comparison information runs the check conservatively. The change rule
belongs to your workflow, not a separately maintained path-filter configuration.
Event and branch conditions are separate: use `CI.when` with event/ref conditions
when, for example, only a push to main should release. Those conditions appear
in the plan; ordinary JavaScript branches only describe the path being planned.

[Conditional execution](../conditional-deploy)

## 7. Publish only changed output

Run the adopted workflow twice. It compares the built `dist/**` bytes with the
last successful publication: identical output skips publication; changed output
publishes once. A failed build keeps the previous successful baseline.

This local chapter publishes to `.effect-ci/deployed-site`, not Cloudflare.
Build identity and deployment identity are separate: reusing a build does not
implicitly authorize a release.

[Changed-output deployment](../deploy-changed-output) ·
[Portable artifacts](../portable-artifacts)

## 8. Remote execution without a second workflow

With a configured host and an enrolled, clean pushed commit, move execution off
your laptop:

```sh
pnpm exec cf-ci doctor --remote
pnpm exec cf-ci run --remote
pnpm exec cf-ci run test build --remote
```

The standalone host runs authored workflows inside an isolated container, not
inside the privileged host process. Hosts advertising project goal discovery can
also run selected exported actions. The project CLI validates every requested
goal before executing any of them; older fixed-goal hosts retain their allowlist.

Keep the workflow and move its execution from your laptop to the hosted runner.
Cloudflare workflows retain action checkpoints and workspace snapshots across
durable execution. Remote log streaming lets the CLI follow the same run; a lost
connection must not cause it to dispatch the work again.

[Host setup](../../apps/effect-ci/SELF-HOST.md) · [Durable runner](../cloudflare-runner)

## 9. Signed results and reusable build workspaces

The trusted-runner chapter connects local development, remote checks, and SCM CI:
verify an exact commit once, then reuse matching successful results instead of
running the same checks again after a push.

Pure checks reuse signed results. A build can also return a signed workspace
snapshot, allowing a later action to consume the same files without rebuilding.
Missing, changed, or expired evidence runs the work normally. No signing key
belongs in the app, and a local Vite+ cache hit is not a signed result.

[Result reuse](../verification-evidence) · [Workspace snapshots](../snapshot-fanout) ·
[Hosted integration](../../apps/effect-ci/TRUSTED-REMOTE.md)

## 10. GitHub CI and Slack progress

The conference flow is edit → commit → push → inspect the run in Slack. The
GitHub App starts CI for the pushed commit; Slack keeps one parent progress bar
and a compact, maintained step table. Failures link to the affected step.
Release reviews can add health charts and direct decisions on the same thread,
instead of making the presenter switch between disconnected dashboards.

An authored workflow can also run through GitHub Actions. Where it executes is
separate from the workflow's dependencies and checks.

The copied app does not install the App, enroll itself, or gain Slack access.
Those connections belong to the host setup.

[GitHub CI on Cloudflare](../github-cloudflare-ci) ·
[Slack interaction](../cloudflare-hitl-release)

## 11. Safe-change approval so authors can self-merge

Adjust the GitHub approval policy dynamically. Here, arbitrarily call a change
safe when no TypeScript, TSX, or JSON files changed:

```ts
if (!(yield * source.changed("**/*.(ts|tsx|json)"))) {
  yield * approve();
}
```

That's the entire workflow decision. No `review()` fallback: normal GitHub review
is already the default. A safe change gets approval so its author or agent can
self-merge once all checks and other GitHub requirements pass—not an automatic merge.

The trusted App supplies `approve()` and checks the current diff and commit.
PR code cannot grant itself approval authority.

[Safe-change example](../small-change)

## 12. Previews from the checked build

Branch publication should give you a commit-pinned preview of the same build
that passed CI, without rebuilding it for the browser. Production stays on the
previous release while you review the preview.

The existing hosted showcase has this publication machinery; connecting it to
the copied app is part of the remaining conference integration. The local
directory publisher in chapter 7 is not a hosted preview service.

[Static assets](../static-assets-source) · [Deployment hooks](../deploy-hook) ·
[Ordered deployments](../ordered-deploy)

## 13. Health checks and human release decisions

Upload a candidate without moving production traffic. Then roll it out through
10%, 25%, 75%, and 100%, observing health at each phase.

Healthy results can advance. Unhealthy results restore the previous allocation.
When health is uncertain, pause for a Slack **Progress** or **Reject** decision
rather than pretending sparse data is healthy. Rejection or timeout follows the
configured rollback policy; reaching 100% still needs the final health check.

This is a hosted release chapter, not a command to deploy the copied app or
replay an existing rollout.
[Health-gated rollout](../health-mediated-release) ·
[Human review of uncertain health](../health-mediated-approval) ·
[Slack approvals](../cloudflare-hitl-release) · [Rollback](../rollback-compensation)

## 14. Auto-fix proposals, with independent checks

Close the loop: failure → proposed patch → allowed-diff check → exact-commit
tests → pull request. The proposal does not get to merge or deploy itself.

For the conference demo, this chapter stays modeled/off: walk through the flow
without generating a public error, calling a paid model, or replaying a repair.
Deterministic formatters and linters are the first choice when they can fix it.

[Repair proposals](../flue-repair)

## 15. Keep the controls as the demo grows

- [Required and optional checks](../optional-checks), [timeouts](../execution-policy),
  and [explicit retries](../retry) make failure policy visible.
- [Immutable attempts](../immutable-attempts) keep earlier results rather than
  rewriting a failed run as success.
- [Secret requirements and redaction](../secure-secrets) and
  [host-authenticated outbound requests](../secret-outbound) keep credentials out
  of project code and containers.
- [Worker-isolate checks](../dynamic-worker-checks) and
  [project HTTP checks](../dynamic-project-checks) show lightweight work running
  without a container. A [containerless publication](../containerless-site) can
  also build and serve a small site in isolates; that is not arbitrary Vite/npm support.

The point is one connected app that grows through the whole tour—not a separate
toy project for every feature. The focused examples explain individual pieces;
this README keeps the full route together.
Other runner, source, package-manager, and toolchain combinations belong in the
[capability matrix](../README.md), not extra detours in this presentation.
