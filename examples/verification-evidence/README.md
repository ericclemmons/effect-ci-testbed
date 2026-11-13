# Reuse verified checks for a commit

Avoid repeating a check that already passed for the exact committed inputs.

The snippets on this page come from this example's files, which CI runs end to
end.

## Mark the check as reusable

Create `.cloudflare/ci/actions.ts`. Define the check with `CI.check` and allow
its result to be reused for the same commit:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts "source {14}")

## Configure a check cache

Create `.cloudflare/ci/workflow.ts`. Its `local` export configures a
`gitNotesCheckCache`. With only `EFFECT_CI_CHECK_PUBLIC_KEY` set, it reads and
verifies signed results. With `EFFECT_CI_CHECK_PRIVATE_KEY` also set, it writes
them too. Without a public key, the check always runs.

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source {14-20}")

The [check-cache API](../../packages/github/src/check-cache.ts) accepts these
options. Notes go under `refs/notes/effect-ci` unless you set `ref`:

[Check-cache options](../../packages/github/src/check-cache.ts#symbol=GitNotesCheckCacheOptions "source")

## Try it

```sh
cd examples/verification-evidence
effect-ci run
```

Run the check with the writer configured on a clean commit. Push the commit and
its notes; a reader with the enrolled public key can reuse the result. Missing or
mismatched signatures run the check normally.

The host chooses trusted signers and input contracts. A PR cannot enroll its
own key. Working-tree edits and a different commit require fresh checks.

This example uses Git notes; the deployed host's
[remote-result integration](../../apps/effect-ci/TRUSTED-REMOTE.md) uses host-issued
receipts. Build-output caching and PR approval are separate decisions.

## Compare with GitHub Actions

Conventional GitHub Actions reruns the check every time:

[GitHub Actions comparison](./.github/workflows/github.yml#L11-L17 "source")
