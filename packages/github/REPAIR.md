# Propose one verified demo repair

`proposeRepair` is a **host-only writer primitive**, not an unrestricted coding
agent or a deployed RPC endpoint. It fixes only the owned health-status fixture:

| Boundary | Fixed policy |
| --- | --- |
| GitHub App / installation | Existing App `5089816` / installation `165265172` |
| Repository | `ericclemmons/effect-ci-private-github-fixture` |
| PR base | `demo/friday-repair` — never `main` |
| Allowed edit | `repair-demo/health.js`, regular file, mode `100644` |
| Source | `healthStatus()` returning the literal `500` |
| Candidate | Only the same zero-argument function returning literal `200` |
| Verification | Host-owned exact-commit `node --test repair-demo/health.test.mjs` |
| Writes | One owned `codex/repair-RUN` branch and proposed PR; no overwrite/merge/deploy |

Model text is capped at 1 KiB. An optional single JavaScript code fence is accepted;
extra explanation, imports, tools, commands, expressions and other functions are
rejected. Accepted output becomes one canonical source string. **Nothing from the
model is evaluated by this writer.** This is intentionally a narrow demonstration,
not a claim that arbitrary repairs are safe.

## How it works

1. Validate the run, full base commit and allowed candidate before minting a token.
2. Mint only **Contents: write + Pull requests: write** for the one private fixture.
   The existing parent App credential remains broader; never give it to project
   code, containers, models or callers. The writer token is revoked on success
   and failure. Ordinary CI reporting/checkout keep their separate read-only scopes.
3. Require the dedicated base branch still to match the expected commit. Read
   actual Git tree/blob bytes; verify Git object hashes, regular-file mode and
   the exact owned failing source. Reject symlinks, submodules, malformed,
   duplicate or truncated trees. Hash the expected replacement tree locally,
   preserving every other object; a replay branch must match that exact tree,
   parent and owned commit message.
4. Create a fix commit and create-only branch, then call the **trusted host
   verifier** on that exact commit. A failed, stale or mismatched receipt produces
   no PR. An owned branch may remain for inspection; it is not silently deleted.
5. Re-check both refs and create a PR only after verification. Replays find the
   same owned App PR and exact commit/patch identity. A foreign, closed or
   ambiguous PR is not reused, overwritten or duplicated.

Every request goes to a fixed GitHub API origin, rejects redirects, bounds response
bytes and has a ten-second transport deadline. Errors omit server bodies,
credentials, proposed text and verifier exceptions. A lost write acknowledgement
fails rather than blindly retrying; a later explicit invocation reconciles its
owned branch/PR. GitHub does not provide an atomic transaction across all these
operations: checks detect observed ref drift, not every possible concurrent write.
Proposed PRs still require review.

```ts
// Trusted host module only. This callback is NOT supplied by the model or RPC caller.
const proposal = await proposeRepair(credentials, {
  runId: incident.runId,
  baseCommit: incident.hostPinnedBaseCommit,
  proposedText: untrustedModelReply,
}, async input => hostVerifier.verifyExactCommit(input))
```

The verifier must actually run the fixed check on bytes from the bound commit and
return its commit/source digest and persisted receipt identity. A regex match,
caller-provided `passed: true`, cached unrelated result or advisory Git note is not
verification. The receipt is **not** signed reusable cache authorization or hardware
attestation. Never relabel a Dynamic Worker assertion as a Node command it did not
execute.

## Current evidence and remaining integration

Eight unit tests use **mock GitHub replies** to cover exact scope, verification
ordering, one-file tree identity, drift, foreign PRs, unsafe model output, token
revocation and lost-response replay. Tree hashing is compared to independent
`git hash-object`; that command does not write Git objects. No GitHub repository
mutation, native writer, Flue agent, actual verifier or proposed repair PR is
claimed by these tests.

The dedicated failing branch still needs create-only fixture setup (preserve the
existing private repository `main`), a genuine exact-commit verifier, a host RPC
boundary and real successful/denied/replay E2E. Workers Issues delivery and the
budgeted Flue agent are separate remaining slices. Video and measured end-to-end
repair timings are not yet recorded. Track implementation in
[#159](https://github.com/ericclemmons/effect-ci-testbed/issues/159).
