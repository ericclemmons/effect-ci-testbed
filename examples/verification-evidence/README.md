# Reuse verified checks for a commit

Avoid repeating a check that already passed for the exact committed inputs.

[Source](./.cloudflare/ci/actions.ts#symbol=lint "source")

## Try it

```sh
pnpm exec cf-ci run --workflow examples/verification-evidence/.cloudflare/ci/workflow.ts
```

Configure a `gitNotesCheckCache` writer after running the check on a clean commit.
Push the commit and its notes; a reader with the enrolled public key can reuse
the result. Missing or mismatched signatures run the check normally.

The host chooses trusted signers and input contracts. A PR cannot enroll its
own key. Working-tree edits and a different commit require fresh checks.

This example uses Git notes; the deployed host's
[remote-result integration](../../apps/effect-ci/TRUSTED-REMOTE.md) uses host-issued
receipts. Build-output caching and PR approval are separate decisions.

[Recorded environment coverage and remaining comparison work](./EVIDENCE.md).

[Actions](./.cloudflare/ci/actions.ts) ·
[Check-cache API](../../packages/github/src/check-cache.ts)
