# Local graph verification

Date: October 26, 2026 (America/Chicago).
Baseline: main `20f29103911800606929de4f9afa095667606e48`.
Tool: installed and locked Turbo 2.11.10; Node 24.22.1; pnpm 12.8.1.

## What ran

`node examples/task-graph-deploy/plan.ts` produced four nodes from the installed
tool's actual dry-run JSON. Two successive normalized plans compared equal.
The dry run imported task metadata only; it did not execute deployment commands.

An inline Node invocation called the actual exported `executeGraph` with local
async callback bindings. The observed callback trace was:

```text
effect-ci-ordered-deploy-backend#build
effect-ci-ordered-deploy-frontend#build
effect-ci-ordered-deploy-backend#deploy
effect-ci-ordered-deploy-frontend#deploy
```

The executor awaited each callback before starting the next. Injecting a rejected
backend deployment callback stopped after the third entry. Injecting a failed
backend build stopped after the first; a failed frontend build stopped after the
second. None invoked the frontend deployment callback. An absent frontend handler
was rejected before any callback ran.

The actual importer rejected a missing dependency, a cycle from backend build
back to frontend deployment, a duplicate task ID, and a missing build script.
These were inline validation calls, not new or modified repository tests.

The installed Turbo binary also rejected two temporary configurations before
execution: a backend-build/frontend-deploy cycle, and a dependency on
`missing-package#deploy`. The recipe's committed configuration was not altered
for either check.

Both existing fixture apps built successfully with their installed
`./node_modules/.bin/cf build --mode production` from each app directory. These
were separate native builds, not deployments or a graph-driven hosted run.
The build tool required a loopback listener outside the filesystem sandbox.

The graph recipe and ordered-deploy fixture passed TypeScript checks. The
existing documentation/ergonomics suite passed all 17 tests. No tests changed.
The frozen lockfile install and full `pnpm check` also passed, including all
example type checks and existing workflow-plan checks. The documentation build
verified 92 collocated README routes, internal links and source snippets.

## What this does not prove

These callbacks did not deploy Workers or serve an API. They demonstrate the
executor's order and rejection behavior, not target health, idempotency across
retries, broker permissions or native runner durability. No new targets, secrets
or permissions were created. No existing historical evidence was replaced.

The explicit-order baseline builds both apps before its two dry-run deployments.
The graph retains both builds before backend deployment, matching #151's
unlanded shared-preparation contract for pinning both output digests.
Both require frontend deployment to follow successful backend deployment; only
#151's future owner callback can make that success include actual served health.

Hosted execution and the explicit-versus-imported hosted comparison remain
blocked by [#151](https://github.com/ericclemmons/effect-ci-testbed/issues/151).
[Issue #153](https://github.com/ericclemmons/effect-ci-testbed/issues/153) must stay
open until those target-environment receipts exist.
