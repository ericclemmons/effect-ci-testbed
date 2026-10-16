# Adopt Effect CI, one capability at a time

> How far can an existing Vite project go without replacing its scripts?

One app, one rehearsal branch. Make a change, run it, push it, inspect Slack.
Host rollout for the new main/preview policy is pending native verification.

## 0. Set up once

> Use this repository and its hosted integration. No new repo or worktree.

From a clean repository checkout:

```sh
git fetch origin main
git switch -c demo/rehearsal origin/main
pnpm install
export PATH="$PWD/node_modules/.bin:$PATH"
cloudflared access login https://effect-ci-github-cloudflare.ericclemmons.workers.dev
cd examples/demo
pnpm build
```

Use Node 24.11+ or Node 26+. Keep this shell open. Run `pnpm dev` to edit the app.
The Access login is for the hosted app; GitHub pushes use your normal GitHub login.

## 1. Discover the project

> Existing package scripts become actions. No workflow file required.

```sh
cf-ci
cf-ci list
cf-ci plan --format=mermaid
```

## 2. Run goals before pushing

> Ask for test and build together, not a hand-maintained setup sequence.

```sh
cf-ci run test build
```

In `src/message.ts`:

```diff
-export const message = "Hello from the demo app.";
+export const message = "Hello from my rehearsal.";
```

```sh
cf-ci run test build
```

## 3. Give your agent the same commands

> Structured results without a different CI path.

```sh
export AI_AGENT=true
cf-ci list
cf-ci run test build
```

## 4. Reuse unchanged task output

> Vite+ validates its task inputs and outputs; no handwritten cache key.

```sh
time cf-ci run build
time cf-ci run build
```

Change `src/message.ts` and repeat. Inspect Vite+'s actual hit/miss output.
[Cache details](../vite-plus-cache).

## 5. Replace the manual GitHub job

> Keep package scripts. Replace their YAML execution steps with one workflow reference.

[`.github/workflows/github.yml`](./.github/workflows/github.yml):

```diff
--- a/.github/workflows/github.yml
+++ b/.github/workflows/github.yml
@@
 permissions:
   contents: read
+  checks: write
@@
 jobs:
   ci:
-    runs-on: ubuntu-latest
-    steps:
-      - uses: actions/checkout@v7
-      - uses: voidzero-dev/setup-vp@v1.21.2
-        with:
-          node-version: 24
-          cache: true
-          run-install: true
-      - run: npm run lint
-      - run: npm run check
-      - run: npm run typecheck
-      - run: npm run test
-      - run: npm run build
+    uses: ericclemmons/effect-ci-testbed/.github/workflows/effect-ci.yml@main
+    with:
+      workflow: examples/demo
+    secrets: inherit
```

This reference runs **on GitHub Actions**, not Cloudflare. It uses this repo's
configured App secrets; it is not a standalone-repo installer.

## 6. Make dependencies explicit inside actions

> The workflow requests goals. Each action owns its prerequisites.

```diff
--- /dev/null
+++ b/.cloudflare/ci/workflow.ts
+import * as CI from "@effect-ci-testbed/ci";
+import * as actions from "./actions.ts";
+export * from "./actions.ts";
+
+export default CI.workflow("cf-ci-demo", function* () {
+  yield* CI.parallel([actions.test(), actions.build()]);
+});
```

```sh
cf-ci plan --format=mermaid
cf-ci run test build
```

The shipped [actions](./.cloudflare/ci/actions.ts) share installation and parallel
lint/check/typecheck prerequisites. Either goal pulls them in; shared work runs once.
Marker-free script discovery is still conservative and serial in its default workflow.

## 7. Push for hosted CI and Slack

> Stay on your branch. The hosted App builds the pushed commit.

```sh
git add src .cloudflare/ci
git commit -m "Rehearse the demo"
git push -u origin HEAD
```

Open [#effect-ci in Slack](https://app.slack.com/client/TBXG40NPN/C0C81FU4B5J).
The parent card shows status and the preview link. Its thread holds step output.
Click **Details on that Slack parent card** for the same Cloudflare Workflow run.

The host currently selects its fixed demo program, not uploaded `workflow.ts`.
Local authored goals and the hosted program are separate until remote parity lands.

## 8. Verify previously checked work

> Trust exact evidence, not an agent saying “tests passed.”

Full test-suite reuse is not enrolled yet. The existing live proof verifies only
the pure syntax check; lint and tests still execute.
[Attestation policy and actual positive/negative runs](../../apps/effect-ci/README.md).

## 9. Consume the build in a deploy action

> Deployment depends on successful test and build, even when requested alone.

```diff
--- a/.cloudflare/ci/workflow.ts
+++ b/.cloudflare/ci/workflow.ts
@@
-  yield* CI.parallel([actions.test(), actions.build()]);
+  yield* actions.deploy();
```

```sh
cf-ci run deploy
```

The local action prints a deployment preview from `.cloudflare/ci/deploy.ts`:
actual built-file sizes and hashes, with `deploymentPerformed: false`.
It is not an external deployment. Hosted publication uses the private publisher below.

## 10. Open the hosted preview

> The browser receives the same checked build, not a second build.

Open **Open preview** on your Slack card. Edit the release message, commit and
`git push` again to publish a new commit-pinned preview. Production stays unchanged.

These are static previews of this Vite app, not resource-isolated Workers Previews.
[Publication and resource details](../../apps/demo-site/README.md).

## 11. Release from main

> Main is production; other branches are previews. No special release branch.

```sh
gh pr create --base main --fill
```

Merge your rehearsal PR into `main` on GitHub. In Slack, inspect the same build's
graphs and choose **Progress** or **Reject** at 10%, 25%, 75% and 100%.
Allow two minutes between phases. Sparse data remains uncertain; Progress accepts
that risk. Reject/timeout restores the prior allocation. Final Progress commits.

Open [the released app](https://effect-ci-hmd-demo.ericclemmons.workers.dev/).
[Release configuration and native evidence](../../apps/effect-ci/DEMO-RELEASE.md).

## 12. Close the loop with an error event

> HTTP failure → authenticated event → Flue proposal → exact-commit test → unmerged PR.

The old one-shot public error reached WOBS but stopped at admission; that run is
not a completed automatic repair. The new end-to-end test is pending.
[Current incident status](../../apps/repair-events/PUBLIC-ACTIVATION.md).

The separately completed Flue → native Node → proposed PR path can be inspected
without spending or changing anything, from the repository root:

```sh
node examples/flue-repair/verify.ts
```

[Flue integration and actual unmerged proposal](../flue-repair).

## Verification proof

Maintainer evidence, not adoption steps: [recording notes](./verification/README.md).
**Video:** [Historical local recording](./verification/README.md).
**Measured results:** [Historical capture receipt](./verification/published/local-4ebc193.json).
[Proof-page contract](../PROOF-PAGES.md).
