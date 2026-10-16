# Flue proposes. Native checks verify. A PR waits for review.

> Can Flue propose a repair while independent checks—not the model—decide whether it deserves a PR?

From this repository's root, with the existing Cloudflare CLI and GitHub sessions:

```sh
node examples/flue-repair/verify.ts
```

This checks the **original real hosted run** against Cloudflare and GitHub now,
then prints the [unmerged proposed PR](https://github.com/ericclemmons/effect-ci-private-github-fixture/pull/2).
The private fixture requires your existing repository access. The command is
read-only; it does not ask a model again or manufacture a new run for playback.

The deliberately broken function returned HTTP status `500`; its test expected
`200`. The real Flue-generated Cloudflare agent proposed the corrected function.
A separate trusted writer pinned the private fixture's base, accepted only the
allowed one-file patch, and sent the exact candidate commit to a separate native
Node verifier. Only after the check passed did it open PR #2. Nothing merged or
deployed. The verification command checks that ordering and the exact patch.

| Responsibility | Implementation |
| --- | --- |
| Generated Flue agent; untrusted proposal only | [Agent](../../apps/repair-agent/src/agent.ts) |
| Durable submission identity and budgeted provider | [Provider](../../apps/repair-agent/src/provider.ts) |
| Native Workflow dispatch, receipt and ledger checks | [Coordinator](../../apps/repair-agent/src/proposal.ts) |
| Narrow private-fixture GitHub writer | [Writer](../../packages/github/src/repair.ts) |
| Independent exact-commit verification | [Verifier](../../packages/github/src/repair-verifier.ts) |

This command verifies a **recorded operator-triggered Flue example**, not the public
HTTP500 run. That newer run automatically produced a fresh proposal, passed its
native check and created [unmerged PR4](https://github.com/ericclemmons/effect-ci-private-github-fixture/pull/4),
then failed its final acknowledgement on the renamed bot's login.
[Exact result, retained failure and completed operator reconciliation](../../apps/effect-ci/PUBLIC-REPAIR.md).
Verify that actual public-error run read-only with `node examples/flue-repair/verify-public.ts`.
Neither example is a portable fresh-repo
installer. [Host setup, permissions, budget, native receipts and limits](../../apps/repair-agent/README.md).
Do not redispatch the historical instance, reset its budget, or merge/deploy the
proposal. A genuinely new model task needs separately enrolled source and a
create-only intent within the existing lifetime authorization.

## Formatting and lint fixes do not need a model

> Use a deterministic fixer when a deterministic fixer exists.

Prettier formatting and supported lint `--fix` rules should run their own fixed
tools. Then verify the exact repaired commit and open an unmerged PR only if
the allowed diff and checks pass. Syntax errors and arbitrary lint findings are
not automatically fixable. This is a separate recovery path, not Flue reasoning.

The shared [formatter recovery guard](../../packages/source-tools/src/format-recovery.ts)
uses pinned Prettier without project plugins/configuration and independently
recomputes candidate bytes from the base snapshot. Its local negative tests reject
changed meaning, extra/deleted paths, syntax errors and no-op proposals:

```sh
node --test packages/source-tools/src/format-recovery.test.ts
```

That guard is **not yet an end-to-end formatting PR demo**. It performs no GitHub
writes, native verification or automatic activation; those remain to be wired.

## Verification proof

**Video:** Pending. No successful recording is claimed.

**Measured results:** [Original native Flue proposal and limits](../../apps/repair-agent/README.md#recorded-native-proposal).
The read-only command verifies retained histories and current GitHub evidence;
its runtime is not fresh model latency or a new repair benchmark.
[Proof-page contract](../PROOF-PAGES.md).
