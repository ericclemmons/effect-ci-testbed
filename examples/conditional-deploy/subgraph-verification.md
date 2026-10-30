# Conditional subgraph evidence

This extends the existing single-action `CI.when` recipe; it does not replace its
workflow, source-change example, or historical hosted proof. The implementation
baseline is `20f29103911800606929de4f9afa095667606e48` on `main`.
The local receipt's source hashes match implementation commit
[`490747ac6db43200c36e905a58d5b7e9116f10d0`](https://github.com/ericclemmons/effect-ci-testbed/commit/490747ac6db43200c36e905a58d5b7e9116f10d0)
in [Draft PR #408](https://github.com/ericclemmons/effect-ci-testbed/pull/408).

## Evidence boundary

The new `CI.branch` contract and two-branch fixture are implemented on the PR
branch, not landed. Local runs execute real shell commands through Effect's
default executor. No external deployment occurs. Existing runner unit tests are
not actual hosted proof. No tests were added or edited.

| Environment | Both alternatives | Optional warning | Required failure and reverse cleanup |
| --- | --- | --- | --- |
| Conventional shell, local macOS | Verified | Verified | Verified |
| Effect Local, macOS / Node 24.22.1 | Verified | Verified | Verified |
| Conventional GitHub runner | Configured; no result claimed | Configured | Not yet recorded |
| Effect GitHub adapter | Configured; no result claimed | Configured | Not yet recorded |
| Cloudflare Workflows/Containers | Not verified for this fixture | Not verified | Not verified |

The existing Cloudflare `ConditionalDeployWorkflow` still imports the original
single-action fixture. Its historical successes do not prove this new API.
Updating that shared host affects many unrelated recipes; this change does not
deploy it, repurpose its existing entrypoint, create a new hosted resource, change
Access or callbacks, or grant permissions. A target-owner decision is needed
before running the new fixture there. Issue #147 remains open until the hosted
matrix is complete.

## Local runs

[Local receipt](./verification/subgraph-local.json) records source-file hashes,
the event/ref for each run, the final plans, exit codes, successful stdout and
failed-command diagnostics. Absolute local workspace paths are normalized to
`<recipe>`; these are local observations, not signed reusable attestations.

Both events produce plans with the same named actions and two complementary
conditions. Each run selects only one lane. Its advisory fails and is recorded as
`warning`, while its publish/verify and the final report complete. Unselected
members and their cleanup actions remain `skipped`.

For each event, `refs/heads/required-failure` makes publish fail with exit code 1.
The remaining lane verification is skipped; the final report never runs. Cleanup
commands run for the failed publish, then the completed prepare. The unselected
lane does not execute, even during cleanup. The conventional shell comparison
produces the same ordered operations and exit codes.

The recipe's source-change `if/else` remains runtime control flow: it is not
represented as a two-path serialized predicate. Branch planning uses the existing
plan interpreter, not an ahead-of-time evaluator for arbitrary Effect code.
Rerun reuse fails closed if a branch's serialized shape or selection changes.

## GitHub execution

[Recipe workflow](../../.github/workflows/conditional-subgraph.yml "source")

The workflow runs the conventional shell for both events and calls the existing
Effect GitHub adapter for plan/execute with each event. It reuses the repository's
existing token setup; it does not introduce credentials or modify the adapter.
No pipeline waiting is part of this change. Configured jobs are not passing jobs.
The one post-push snapshot found
[run 40438670248](https://github.com/ericclemmons/effect-ci-testbed/actions/runs/40438670248)
queued for the initial `bd0ff1b5bd952c0c94b16fa8af2ebb8b710de2f0` implementation;
no completed GitHub result or hosted proof of the later rollback-ownership guard
is claimed.

## Existing validation

- `pnpm check`: passed, including package/app typechecks, recipe plans and docs.
- Core and CLI suites: 96 passed.
- Cloudflare and GitHub suites: 243 passed, 3 skipped.
- Existing conditional-deploy and real CLI output-change checks: passed.
- `git diff --check`: passed.

The runner/CLI suites needed loopback access outside the filesystem sandbox;
their first sandbox runs failed to bind local HTTP servers. This is not hosted
runner evidence. All existing test files remain unchanged.
