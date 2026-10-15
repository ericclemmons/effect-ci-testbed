# Adopt Effect CI, one capability at a time

> How far can an existing Vite project go without replacing its scripts or rewriting its CI?

This is a hands-on adoption guide, not a presentation script. Each step adds a
capability: make the change, run the command, inspect the result. Stop or skip
wherever you want. There is no three-minute schedule or prescribed narration.

## 0. Start with a standalone Vite repo and ordinary GitHub Actions

> Start with working CI. Adopt Effect CI without rewriting the application.

```sh
npx --yes tiged ericclemmons/effect-ci-testbed/examples/demo cf-ci-demo
cd cf-ci-demo
npm ci
npm run lint
npm run check
npm run typecheck
npm test
npm run build
git init -b main
git add .
git commit -m "Start with a Vite app and conventional GitHub Actions"
gh repo create ericclemmons/cf-ci-demo --private --source=. --push
gh run list
```

Open <https://github.com/ericclemmons/cf-ci-demo/actions> in the browser.

Open <https://github.com/settings/installations/165265172> in the browser. For
**Effect CI**, select **All repositories**, then **Save**. This extends the App's
existing Contents/PR/Checks permissions to all repositories; it does not authorize
automatic merging or deployment.

[tiged subdirectory copying](https://github.com/tiged/tiged#specify-a-subdirectory) ·
[GitHub repo creation](https://cli.github.com/manual/gh_repo_create) ·
[Baseline workflow](./.github/workflows/github.yml)

**Not live yet:** the portable one-`uses:` Cloudflare action. The current reusable
workflow is monorepo-specific; installing the App alone does not enroll new repos.

Start with an existing Vite/Vite+ package with a lockfile and ordinary
`lint`, `test`, and `build` scripts. This checked-in fixture is a small Vite+
web application: HTML entrypoint, TypeScript source, lint, types, tests and build.
The build also retains an exported message module for the existing verification
harness. Hosted build, serving and reviewed release below now use this same
application. Portable Cloudflare onboarding and automatic repair remain unfinished;
unrelated historical runs do not substitute for them.

The CLI and libraries are currently private workspace packages, not a published
npm onboarding path. In this testbed, from the repository root:

```sh
pnpm install --frozen-lockfile
export PATH="$PWD/node_modules/.bin:$PATH"
cd examples/demo
```

Run `npm run dev` to edit the application, or `npm run preview` after a build to
inspect the built application. Both print their local URL.

Use Node 24.11+ or Node 26+. Keep agent implementation work in managed worktrees;
the primary checkout stays clean on main. Local source edits below are intentional
feedback experiments, not signed proof.

## 1. Discover what this project can do

No workflow, CI marker, or YAML change is needed:

```sh
cf-ci
cf-ci list
cf-ci plan
cf-ci plan lint
cf-ci plan --format=mermaid
```

Help and list show exact runnable commands, including `cf-ci run lint`,
`cf-ci run test`, and `cf-ci run build`. Plan resolves dependencies without
executing them or creating files. Mermaid describes the selected graph; it is not
a promise that package scripts have arbitrary parallel-safe dependencies.

**Inspect:** [package.json](./package.json) and [vite.config.ts](./vite.config.ts).
Discovery uses conventional package scripts and their lifecycle hooks.
[Zero-config details](../zero-config).

## 2. Run the existing scripts before pushing

> Instead of running ad-hoc npm scripts, agents run the same CI workflows (or actions) as the cloud.

```sh
cf-ci run lint
cf-ci run test
cf-ci run build
cf-ci run
```

```diff
--- a/src/message.ts
+++ b/src/message.ts
-export const message = "Check my work before I push";
+export const message = "Checked locally, ready for CI";
```

```sh
cf-ci run build
cat dist/message.js
```

```diff
--- a/src/message.ts
+++ b/src/message.ts
 export const message = "Checked locally, ready for CI";
+asdf;
```

```sh
cf-ci run lint
# Expected: undefined-variable diagnostic; nonzero exit.
```

```diff
--- a/src/message.ts
+++ b/src/message.ts
 export const message = "Checked locally, ready for CI";
-asdf;
```

```sh
cf-ci run lint
# Expected: exit 0.
```

## 3. Use the same commands as an agent

An agent runs exactly the same commands:

```sh
cf-ci --help
cf-ci list
cf-ci plan lint
cf-ci run lint
```

`@vercel/detect-agent` detects `AI_AGENT` and tool-specific environment signals.
Human terminals default to text; agent environments default to JSON.
No `--agent` flag is required. To inspect that interface from a human terminal:

```sh
export AI_AGENT=true
cf-ci list
cf-ci plan lint
cf-ci run lint
```

JSON list includes both target names and exact runnable commands. Explicit
`--format=text` or `--format=json` overrides detection. Detection changes output,
not trust, permissions, execution location, or whether a check passed.

Local command failures include `error.details.output.stdout` and `.stderr` from
that same attempt. Each retains its last 32K characters; `truncated` explicitly
marks clipping. No text-mode rerun is needed. Adapters with an existing combined
diagnostic expose it as `output.text`.

With the updated native host, remote failures include
`error.details.diagnostics`: step, command, directory, exit code and both output
tails. Native tails are at most8K characters per stream and may shrink further
to keep the entire error transport within32KiB UTF-8; `truncated` marks either
limit. The failed checkpoint still throws and configured retries are unchanged.
See [verification boundaries](verification/README.md#native-command-diagnostics)
for the currently tested environment; older deployed hosts may have only a
combined error message, not invented separate streams.

## 4. Reuse task output, then invalidate it

```sh
time cf-ci run build
time cf-ci run build
```

Inspect Vite+'s cache-hit/miss output. Change the string in `src/message.ts` and
repeat: the changed input must invalidate the task; an immediate repeat can hit.

```sh
rm dist/message.js
cf-ci run build
```

A README-only edit should not invalidate a task that does not read it.

Optional task-cache-cold comparison, **only in a disposable checkout**:

```sh
vp cache clean
time cf-ci run build
time cf-ci run build
```

Do not clean the shared checkout for a presentation. This clears Vite task cache,
not the package store or every machine cache. Installation still runs on each
inferred invocation. A tiny cached task need not be faster than executing it.
[Vite+ caching](../vite-plus-cache) owns task reuse; this is not attestation.

## 5. Adopt on GitHub without moving execution yet

Keep the existing workflow and package scripts first. Compare these checked-in files:

- [Conventional GitHub Actions](./.github/workflows/github.yml): runs the scripts directly.
- [Effect on GitHub reference](./verification/effect-on-github.example.yml): selects `examples/demo`
  in the repository's [reusable runner](../../.github/workflows/effect-ci.yml).

For this monorepo, the essential job change is:

```yaml
permissions:
  contents: read
  checks: write

jobs:
  ci:
    uses: ./.github/workflows/effect-ci.yml
    with:
      workflow: examples/demo
    secrets: inherit
```

> Caching is on by default. No cache keys or paths to configure.

```diff
     with:
       workflow: examples/demo
+      cache: false
```

This is repository-specific setup, **not** a self-contained snippet to paste into
an unrelated repo: the reusable workflow and its explicitly scoped GitHub App
credentials must exist there. Do not add unrelated secrets. Keep the old job while
comparing actual results, then remove duplication deliberately.

Both local and Effect-on-GitHub plan/execution for the renamed demo passed in
[PR228's exact full suite](https://github.com/ericclemmons/effect-ci-testbed/actions/runs/38660283645).
That proves this fixture on GitHub, not native Cloudflare execution of arbitrary
zero-config packages.

## 6. Make orchestration explicit when scripts stop being enough

> Compose the existing [actions](./.cloudflare/ci/actions.ts) into a workflow.

```diff
--- /dev/null
+++ b/.cloudflare/ci/workflow.ts
+import * as CI from "@effect-ci-testbed/ci";
+import * as actions from "./actions.ts";
+
+export { lint, check, typecheck, test, build, syntax } from "./actions.ts";
+
+export default CI.workflow("cf-ci-demo", function* () {
+  yield* actions.lint();
+  yield* actions.check();
+  yield* actions.typecheck();
+  yield* actions.test();
+  return yield* actions.build();
+});
```

```sh
cf-ci
cf-ci plan --format=mermaid
cf-ci run lint
cf-ci run
```

The explicit workflow takes precedence over the empty marker. Exported actions
become runnable commands.
[Complete package-manager composition](../node-npm) and
[exported targets](../exported-actions).

### Detect the package manager

> Keep the actions; replace npm-specific commands with lockfile-based detection.

```diff
--- a/.cloudflare/ci/actions.ts
+++ b/.cloudflare/ci/actions.ts
@@
       const workspace = yield* checkout();
-      return yield* workspace.exec("npm ci");
+      const pm = yield* CI.PackageManager.JavaScript(workspace);
+      return yield* pm.install();
@@
       const workspace = yield* install();
-      return yield* workspace.exec(`npm run ${name}`);
+      const pm = yield* CI.PackageManager.JavaScript(workspace);
+      return yield* pm.run(name);
```

```sh
cf-ci plan --format=mermaid
cf-ci run
```

## 7. Run a pushed commit remotely

> Same command, hosted execution. Reuse the existing Cloudflare Access login.

```sh
cf-ci run --remote
```

```sh
# Only if the existing Access session has expired:
cloudflared access login https://effect-ci-github-cloudflare.ericclemmons.workers.dev
cf-ci run --remote
```

Expect a native Workflow instance and streamed action events with a terminal
success/failure. Do not redispatch if the stream disconnects without first
inspecting the original instance. Never pass personal credentials into project
code, containers, or agent prompts.

The host's `DemoCIWorkflow` selects this package's manifest and uses the same
`CI.fromPackageJson` discovery as the local CLI. Its `/demo` mount has separate
dispatch, status and event-stream routes, without changing the existing root
workflow. Host policy permits only this repository, a full commit SHA and the
whole suite. It does not accept an incoming module or deployment target.

For the owned testbed's enrolled `demo/live` branch, push a new source change:

```sh
git push origin HEAD:refs/heads/demo/live
```

Open **#effect-ci** in Slack. The same card shows the build, then the enrolled
GitHub flow waits for the release decisions in [step 11](#11-release-the-checked-build-with-a-decision).
It reaches Passed only after the release commits. Remote CLI runs remain quiet,
build-only runs: they publish/prepare but never shift traffic. This enrollment is
specific to the owned host, not standalone Cloudflare onboarding.
[Host enrollment and actual evidence](../../apps/effect-ci/DEMO-RELEASE.md).

**Live verified:** `cf-ci run --remote` from clean commit
`2c8a27600b168655c2fd989e4abb200d60f3ffb8` completed all seven nodes in native
Workflow `f62fe0db-05e6-4acd-9492-9c8cbfacb6ac`: install, lint, formatting,
type-checking, tests and the real Vite build. The CLI automatically selected JSON
and exited `0`, without an agent or format flag. The build produced
`dist/index.html`, `dist/app.js` and `dist/message.js`.

The first attempt exposed a missing remote-filesystem connection; that failed
history remains preserved separately. This corrected run took 80.263 seconds
including 0.634 seconds queued, with an existing workspace-cache snapshot
restored. It is one observed run, not a cold benchmark or signed reuse, browser
verification, artifact publication or deployment of this Vite app.
[Read-only native regression](../../apps/effect-ci/src/live-demo.test.ts).
[GitHub-to-Cloudflare composition](../github-cloudflare-ci).

## 8. Attest a pure check, then let hosted CI verify reuse

> Sign a clean committed check. Hosted CI verifies its exact inputs; ordinary actions still run.

```diff
--- a/.cloudflare/ci/workflow.ts
+++ b/.cloudflare/ci/workflow.ts
@@
 export default CI.workflow("cf-ci-demo", function* () {
+  yield* actions.syntax();
   yield* actions.lint();
```

```sh
git add src .cloudflare/ci
git commit -m "Add a reusable syntax check"
git push
cf-ci run --remote
node .cloudflare/ci/attest.ts
git push origin refs/notes/effect-ci-hosted-checks-v1
cf-ci run --remote
```

The signer executes the fixed parse-only TypeScript check in the host's immutable
Linux Node image, with networking disabled and only committed inputs mounted.
It never links or evaluates source. The enrolled demo key remains local; Docker
and the hosted runner receive no private key. Evidence binds repository, full
commit, check, command, policy, actual file bytes and exact Node executable/runtime.
Missing, invalid, unknown-key or changed-input evidence is a miss, not permission
to skip execution. Builds and other ordinary actions still execute.

**Live verified on Cloudflare**, using clean commit
[`b22f6cf`](https://github.com/ericclemmons/effect-ci-testbed/tree/b22f6cfc30b7feb480cb25e30a86576a431276cb):

| Evidence                                                  | Syntax check             | Six ordinary package commands |
| --------------------------------------------------------- | ------------------------ | ----------------------------- |
| Missing note                                              | Executed                 | Executed                      |
| Valid signed exact-input note                             | Verified; parser skipped | Executed                      |
| Invalid signature, wrong commit/input/policy, unknown key | Rejected; executed       | Executed                      |

The original valid note was restored after every negative run; its Git history and
the failed proofs are preserved. [Read-only native regression](../../apps/effect-ci/src/live-demo-signed-check.test.ts).

The attested host starts from a fresh image, not a previous whole-container cache
snapshot that could contain project-modified system files. Vite+ still validates
task outputs; restoring native cache files without restoring executable system
state is a separate transport requirement. The GitHub runner's automatic cache
defaults are unchanged.

This is [#144](https://github.com/ericclemmons/effect-ci-testbed/issues/144).
[Cross-merge reuse](https://github.com/ericclemmons/effect-ci-testbed/issues/229)
must issue new commit-bound evidence; copying a signature onto a merge/squash/rebase
SHA does not make it valid.

## 9. Use the build output in another action

> Return a workspace. The next action gets its files automatically—no cache, publish, or restore calls.

```diff
--- a/.cloudflare/ci/workflow.ts
+++ b/.cloudflare/ci/workflow.ts
@@
-export { lint, check, typecheck, test, build, syntax } from "./actions.ts";
+export { lint, check, typecheck, test, build, syntax, verify } from "./actions.ts";
@@
   yield* actions.test();
-  return yield* actions.build();
+  return yield* actions.verify();
```

[`actions.ts`](./.cloudflare/ci/actions.ts):

```ts
export const verify = CI.action(
  "verify build",
  () =>
    function* () {
      const workspace = yield* build();
      return yield* workspace.exec("node .cloudflare/ci/verify-build.ts");
    },
);
```

```sh
cf-ci plan --format=mermaid
cf-ci run verify
git add .cloudflare/ci
git commit -m "Use the build output in another action"
git push
cf-ci run --remote
```

## 10. Serve the checked build

> Build in a container. Serve those same bytes without one.

```sh
cf-ci run --remote
```

Open the [live Vite build](https://effect-ci-demo-site.ericclemmons.workers.dev/r/b302e8cb0965cdbc7da2ab455d696385e782abf7/e9fad7f0e6117c0a33f76d9d9891ebefb2c34519364179e464857a2780efcb23/index.html) in the browser. Click **Show message**.

The enrolled demo host publishes through a private capability; project code gets
no deployment token. This URL is the verified commit above, not a mutable latest
alias or an HMD rollout. [Owned host setup](../../apps/demo-site/README.md).

## 11. Release the checked build with a decision

> Watch one build card. Inspect the actual candidate's graph. Decide what ships.

**Owned testbed enrollment only**, from a clean checkout at `examples/demo`; new standalone repos
still need the unfinished portable Cloudflare onboarding. Preserve the enrolled
branch's history before making a new source change:

```sh
git fetch origin
git switch demo/live
git merge --ff-only origin/demo/live
```

In `src/message.ts`:

```diff
-export const message = "Check my work before I push";
+export const message = "Ship the checked build";
```

```sh
git add src/message.ts
git commit -m "Change the demo message"
git push origin HEAD:refs/heads/demo/live
```

Open **#effect-ci** in Slack. The same card builds and checks the app, then shows
the actual prepared candidate's graph. Inspect each snapshot and choose **Progress**
or **Reject** at 10%, 25%, 75% and 100%. Sparse data stays uncertain; Progress is
explicit risk acceptance, not a fabricated health pass. Each phase has a fixed
two-minute settling interval before its cohort, then a five-minute decision window.
Reject or timeout restores the allocation captured at that run's start. The final
100% Progress commits it; success does not restore an older baseline.

Open the [live release](https://effect-ci-hmd-demo.ericclemmons.workers.dev/) and
click **Show message**. It redirects to the same checked immutable Vite build,
not a second build or Workers Static Assets upload.

**Live verified:** a genuine source push completed this full path with four
explicitly authorized browser-delegated **test** decisions, four real graphs and
one maintained card, then left its candidate committed at 100%. This is not an
independent human-review claim or general standalone onboarding proof.
[Actual run, limits and read-only regression](../../apps/effect-ci/DEMO-RELEASE.md).

Automatic public HTTP 500 → WOBS alert → bounded repair → verified proposed PR
remains unfinished. The [incident host](../../apps/effect-ci/README.md) has separate
ingredient proofs; its earlier operator continuation is not automatic activation.
Never merge/deploy a proposed repair or replay a paid inference to manufacture a demo.

## 12. Let your agent migrate the next project

> Agent-first adoption: tell your agent what you want.

```text
Migrate this project to use cf-ci.
```

## Verification proof

Maintainer evidence, not an adoption step: [recording notes](./verification/README.md).

**Video:** [Historical local recording](https://github.com/ericclemmons/effect-ci-testbed/releases/tag/proof-developer-loop-4ebc193).
**Measured results:** [Historical capture receipt](./verification/published/local-4ebc193.json).
[Proof-page contract](../PROOF-PAGES.md).
