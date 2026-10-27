# Effect CI: the kitchen-sink demo

One Vite app, from short-lived GitHub deployment credentials and existing package
scripts to remote CI, reusable results, GitHub approval, Slack, previews,
controlled releases, and repair proposals.
Each chapter adds a capability without replacing the app's tools.

The local chapters run in the copied app below. The hosted adapter uses the same
authored program for the explicitly enrolled reference app, adding trusted result
reuse, Slack, publication, and release decisions. A copied app or new repository
does not inherit those credentials or permissions. Hosted changes still need
live acceptance before this tour can be called complete. AI is off.

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

## 2. Keep GitHub Actions; replace the deployment secret

Start adopting Effect CI before changing how your checks run. Keep GitHub-hosted
execution and your normal deployment command. Add one authentication step to
exchange GitHub's OIDC identity for a 15-minute Cloudflare token.

The supplied [deployment workflow](./tutorial/oidc.example.yml) builds this same
app, authenticates, and runs its existing deployment tool. After pushing the app
to your own repository:

1. Use the existing shared host configured in
   [.cloudflare/ci/oidc.json](./.cloudflare/ci/oidc.json). Its GitHub App must be
   installed on your repository, and its operator must allow your GitHub owner.
   The supplied default is Eric's personal host, not a public deployment service.
   For another host, change the committed issuer. No host redeployment,
   GitHub repository variable, local Cloudflare login, or Worker bootstrap is
   required for an already-authorized owner. A new owner still needs the host
   operator's approval.
2. Copy the workflow into place and push it:

   ```sh
   cp tutorial/oidc.example.yml .github/workflows/deploy.yml
   git add .github/workflows/deploy.yml
   git commit -m "Deploy with short-lived credentials"
   git push
   gh workflow run deploy.yml
   ```

The job needs `id-token: write`; it requests only `workers:edit`. The
[authentication action](../../.github/actions/cloudflare-auth/README.md) discovers
the committed host, enrolls the signed repository identity, and exports temporary
credentials for later steps. The existing `pnpm run deploy` script runs
`cf deploy --prebuilt`; it does not need the CI CLI or an authentication wrapper.
The action revokes the token after the job, including on deployment failure.
No long-lived Cloudflare token goes into GitHub. The shared host's operator-owned
account policy permits creating new Workers; the Worker name is not a
single-Worker permission boundary. Do not grant an untrusted repository access
to that account-wide policy.
Checks can keep using ordinary package scripts; the next chapter introduces
`cf-ci` without requiring another authentication change.

The [cf recipe](../oidc-cf) and
[shared-host evidence](../../apps/effect-ci/verification/oidc-shared-app.json)
record the earlier live proof of enrollment, remote execution, new Worker
creation, and credential cleanup. They are not proof that your copied app has
already deployed. This tutorial uses the same shared host and ordinary cf CLI.

[Deployment workflow](./tutorial/oidc.example.yml "source")

[Deployment script](./package.json#json=scripts "source")

[Build Output preparation](./scripts/build-output.mjs "source")

## 3. Existing scripts become CI

[Package scripts](./package.json#json=scripts "source")

Link the unpublished CLI and SDK from your installed Effect CI checkout. Replace
the paths. The link makes the CLI available through `pnpm exec` in this app;
it is not a global installation or part of OIDC authentication:

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

## 4. The same commands for people and agents

An author or agent uses the same workflow, with structured results when useful:

```sh
pnpm exec cf-ci run test build --format=json
```

Structured output does not require a model or a separate agent-only CI path.

## 5. Cache tasks and rerun affected work

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
task caching avoids recomputation; signed results are covered in chapter 10.
Choose cache paths and input keys explicitly, or disable caching for a workload.

[Vite+ caching](../vite-plus-cache) · [Turborepo caching](../turborepo-cache) ·
[Dependency downloads](../package-manager-cache) · [Cache policy](../cache-policy) ·
[Dependency-aware reruns](../dependency-aware-reruns)

## 6. Parallel checks, shared prerequisites

Adopt the supplied workflow when you want more control:

```sh
mkdir -p .cloudflare/ci
cp tutorial/workflow.ts .cloudflare/ci/workflow.ts
cp tutorial/program.ts .cloudflare/ci/program.ts
git add .cloudflare/ci
git commit -m "Add CI workflow"
pnpm exec cf-ci run
```

The [workflow](./tutorial/workflow.ts) uses ordinary TypeScript:

[Source](./tutorial/program.ts#symbol=createDemoProgram.build "source")

Actions declare their prerequisites; shared actions run once. Parallel work is
explicit, rather than an automatic reordering of arbitrary JavaScript.
Request an exported action directly when you only need that goal.

[Exported actions](../exported-actions) · [Isolated snapshot fan-out](../snapshot-fanout)

## 7. Source-aware checks

On a branch, commit a README edit and run the workflow. The supplied lint action
can skip it. Commit a change to `packages/greeting/message.ts` and run again:
lint runs, and the app consumes the changed shared package.

[Source](./tutorial/program.ts#symbol=createDemoProgram.lint "source")

Missing comparison information runs the check conservatively. The change rule
belongs to your workflow, not a separately maintained path-filter configuration.
Event and branch conditions are separate: use `CI.when` with event/ref conditions
when, for example, only a push to main should release. Those conditions appear
in the plan; ordinary JavaScript branches only describe the path being planned.

[Conditional execution](../conditional-deploy)

## 8. Publish only changed output

Run the adopted workflow twice. It compares the built `dist/**` bytes with the
last successful publication: identical output skips publication; changed output
publishes once. A failed build keeps the previous successful baseline.

This local chapter publishes to `.effect-ci/deployed-site`, not Cloudflare.
Build identity and deployment identity are separate: reusing a build does not
implicitly authorize a release.

[Changed-output deployment](../deploy-changed-output) ·
[Portable artifacts](../portable-artifacts)

## 9. Remote execution without a second workflow

The copied app already names the shared host in `.cloudflare/ci/oidc.json`.
For your local commands, sign into that host's Cloudflare Access application;
your `gh` login and `cf auth login` are separate identities. The repository must
be accessible to the host's GitHub App. Use a clean, pushed commit, then move
execution off your laptop:

```sh
cloudflared access login --quiet https://effect-ci-github-cloudflare.ericclemmons.workers.dev
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

On the enrolled showcase host, selected goals have individual native checkpoints
and progress. To explicitly rerun affected compute actions, replace `RUN_ID` with
the UUID returned by a completed successful compute run of the same commit:

```sh
pnpm exec cf-ci run build --remote
pnpm exec cf-ci run test --remote --rerun-from RUN_ID
```

The second command creates a new immutable attempt. It reruns test and its
dependents, reusing eligible unaffected work; it does not rewrite the first run.
Expired workspaces, another commit, failed attempts, and publication actions are
not eligible. A rejected request does not silently dispatch a fresh run.

[Host setup](../../apps/effect-ci/SELF-HOST.md) · [Durable runner](../cloudflare-runner)

## 10. Signed results and reusable build workspaces

The trusted-runner chapter connects local development, remote checks, and SCM CI:
verify an exact commit once, then reuse matching successful results instead of
running the same checks again after a push.

Pure checks reuse signed results. A build can also return a signed workspace
snapshot, allowing a later action to consume the same files without rebuilding.
Missing, changed, or expired evidence runs the work normally. No signing key
belongs in the app, and a local Vite+ cache hit is not a signed result.

The enrolled host records signed success and failure observations separately
from reusable successful checks. Public evidence exposes commitments, not private
snapshot handles. A later push can reuse matching checks and the checked build;
an explicit affected rerun bypasses those old caches for the requested work.

[Result reuse](../verification-evidence) · [Workspace snapshots](../snapshot-fanout) ·
[Hosted integration](../../apps/effect-ci/TRUSTED-REMOTE.md)

## 11. GitHub CI and Slack progress

The conference flow is edit → commit → push → inspect the run in Slack. The
GitHub App starts CI for the pushed commit; Slack keeps one parent progress bar
and a compact, maintained step table. Failures link to the affected step and show
captured failure details. When the runner loses a command result, it reports an
unknown exit instead of inventing a test failure or automatically rerunning it.
Release reviews can add health charts and direct decisions on the same thread,
instead of making the presenter switch between disconnected dashboards.

An authored workflow can also run through GitHub Actions. Where it executes is
separate from the workflow's dependencies and checks.

The copied app does not install the App, enroll itself, or gain Slack access.
Those connections belong to the host setup.

[GitHub CI on Cloudflare](../github-cloudflare-ci) ·
[Slack interaction](../cloudflare-hitl-release)

## 12. Safe-change approval so authors can self-merge

Adjust the GitHub approval policy dynamically. Here, arbitrarily call a change
safe when no TypeScript, TSX, or JSON files changed:

[Source](../small-change/workflow.ts#symbol=approveSmallChanges "source")

That's the entire workflow decision. No `review()` fallback: normal GitHub review
is already the default. A safe change gets approval so its author or agent can
self-merge once all checks and other GitHub requirements pass—not an automatic merge.

The trusted App supplies `approve()` and checks the current diff and commit.
PR code cannot grant itself approval authority.

[Safe-change example](../small-change)

## 13. Previews from the checked build

Branch publication should give you a commit-pinned preview of the same build
that passed CI, without rebuilding it for the browser. Production stays on the
previous release while you review the preview.

The enrolled reference app's `demo/showcase-preview` branch selects hosted preview
publication. The trusted adapter consumes the completed build snapshot, publishes
its exact assets, and independently reads their bytes back. The local directory
publisher in chapter 8 is not a hosted preview service; arbitrary copies do not
gain publication authority.

[Static assets](../static-assets-source) · [Deployment hooks](../deploy-hook) ·
[Ordered deployments](../ordered-deploy)

## 14. Health checks and human release decisions

The enrolled reference app's `demo/showcase` branch requests a release. Its first
Slack card is **Start rollout**: a real human must choose **Progress** or **Reject**
before uploading a candidate or changing production traffic. Rejecting or letting
that initial decision expire leaves production unchanged.

After Start, upload the checked candidate without moving production traffic.
Then roll it out through 10%, 25%, 75%, and 100%, observing health at each phase.

Healthy results can advance. Unhealthy results restore the previous allocation.
When health is uncertain, pause for a Slack **Progress** or **Reject** decision
rather than pretending sparse data is healthy. Only the actual human's decision
can release a waiting gate; an agent must not approve it. Rejection or timeout
restores the previous allocation; reaching 100% still needs the final health check.

This is a hosted release chapter, not a command to deploy the copied app or
replay an existing rollout.
[Health-gated rollout](../health-mediated-release) ·
[Human review of uncertain health](../health-mediated-approval) ·
[Slack approvals](../cloudflare-hitl-release) · [Rollback](../rollback-compensation)

## 15. Auto-fix proposals, with independent checks

Close the loop: failure → proposed patch → allowed-diff check → exact-commit
tests → pull request. The proposal does not get to merge or deploy itself.

For the conference demo, AI stays modeled/off. A known failing greeting test can
start a deterministic, narrowly allowed patch proposal from the immutable prepared
workspace. Independent verification runs lint and the direct test task against a
separate candidate workspace and checks that the candidate bytes did not change.

The primary run stays failed. The child proposal and verification have separate
progress and signed observations on the same Slack thread. No pull request is created;
the PR proposal is explicitly modeled. Nothing is merged or deployed. Unknown
command results do not start repair, and failed verification cannot produce a
verified proposal. No paid model, public error, or old repair replay is needed.

[Repair proposals](../flue-repair)

## 16. Keep the controls as the demo grows

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
