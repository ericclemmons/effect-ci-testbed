# Replay a bounded proposal against a real private fixture

This **local operator proof** connects the retained native Workers AI text proposal
to a real GitHub App branch/PR and exact-commit Node check. It is not the automatic
Workers Issues → Flue → hosted repair controller. It replays an earlier fixed model
proposal against identical fixture bytes, rather than claiming the model inspected
this repository or that the whole incident-to-agent sequence ran in order.

The deployed AI broker does not import these scripts, receive GitHub credentials,
or gain code-writing authority. App credentials remain in the local host process;
the Node test child gets only PATH, and model inputs do not include them.

## Run intentionally

From the repository root, with the existing ignored App secret file:

```sh
node --env-file=apps/effect-ci/.secrets.env test/apps/repair-ai/scripts/github-proof.ts seed
node --env-file=apps/effect-ci/.secrets.env test/apps/repair-ai/scripts/github-proof.ts propose
```

`seed` refuses an existing base branch/directory or changed private `main`. It adds
three owned fixture files to a create-only `demo/friday-repair` branch, preserving
the original main commit and every original file. The health test actually fails
on the baseline. A prepared receipt is persisted before creating the branch ref;
a separate confirmed receipt records the read-back. No model request is made.

`propose` only reads `coverage-repair-budget-proposal-20261013-1` from authenticated
native Workflow evidence. It uses the fixed-target writer, reads all three fixture
files from the exact fix commit, checks their Git blob hashes and byte equality,
then executes the real Node test on those pinned bytes. Unknown model code,
scripts or packages cannot reach execution. A repository-only read/checks token
publishes a clearly **local** GitHub check before the writer opens the PR. Both
token purposes are revoked on success/failure. No merge or deployment.

All receipts are create-only, ignored under `.verification/`, and contain no token
or App key. Temporary test artifacts are retained locally. Do not delete receipts
or blindly repeat commands after a lost acknowledgement. Inspect actual refs,
checks and PRs first; the writer primitive can reconcile its owned identities,
but this operator script deliberately requires reconciliation when a completed
receipt already exists. Unreferenced Git objects may remain after an interrupted
seed; this is not an atomic multi-API transaction.

## Evidence boundaries

The owned failing/passing tests and unsafe-input refusal run locally in CI. The
GitHub integration script needs explicit operator invocation and is **not** run by
unit tests or ordinary CI. Actual private branch/PR proof is recorded below.
No fresh AI call, Flue execution, hosted writer, Workers Issues delivery, video or
production fix is claimed here. The private repair PR, once created, stays open
for human review; permission to merge testbed PRs does not authorize merging it.

### Recorded private proof — October 13, 2026

At testbed source `25a5769afa6baef7fb33a8bdccb6ac0c1c299638`:

1. Create-only baseline branch `demo/friday-repair` at
   `352327387f610d84282a567bf9a40ceee3978950`; real owned Node test exited **1**.
   Private `main` stayed `ecf13c17597b2718e44509e8850eba1b0b15866d`.
2. Replayed the retained native proposal without another model call. App committed
   the one-file fix at `bd9682e5b9ca5f8f696ea8052bd5afd4cd2c0a00`.
3. Authenticated exact-commit reads verified the three fixture blobs, then the real
   Node test exited **0**, observed **105 ms** (one sample, not a benchmark).
4. Owned App check `115491016138` completed successfully at **19:18:09 UTC**;
   [private repair PR #1](https://github.com/ericclemmons/effect-ci-private-github-fixture/pull/1)
   was created at **19:18:11 UTC**. Its diff contains only `repair-demo/health.js`,
   returning 200 instead of 500. PR stays open and nothing was deployed.

The unchanged ordinary hosted checkout/install/build also passed on the fix commit;
those checks are not the repair-specific Node test or proof of Flue/Issues delivery.
Ignored prepared/confirmed/proposal receipts preserve actual source, commit,
digest, command, check and environment. Scoped tokens were revoked by the helpers.
No Slack notification or release was performed.

```sh
LIVE_GITHUB_REPAIR=1 node --test test/apps/repair-ai/src/live-github-repair.test.ts
```

That test only reads the existing PR, check and main via the local `gh` login. It
does not spend inference or mutate anything. Video, hosted writer and genuine
incident-triggered Flue execution remain unverified; this is explicitly an
**administrative replay with local verification**, not the final Friday flywheel.
