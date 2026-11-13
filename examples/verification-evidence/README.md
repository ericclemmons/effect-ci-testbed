# Reuse verified checks for a commit

Avoid repeating a check that already passed for the exact committed inputs.

[Source](./.cloudflare/ci/actions.ts#symbol=lint "source")

## Try it

```sh
cd examples/verification-evidence
effect-ci run
```

Configure a `gitNotesCheckCache` writer after running the check on a clean commit.
Push the commit and its notes; a reader with the enrolled public key can reuse
the result. Missing or mismatched signatures run the check normally.

The host chooses trusted signers and input contracts. A PR cannot enroll its
own key. Working-tree edits and a different commit require fresh checks.

This example uses Git notes; the deployed host's
[remote-result integration](../../apps/effect-ci/TRUSTED-REMOTE.md) uses host-issued
receipts. Build-output caching and PR approval are separate decisions.

## Survive rebases and squashes

Commit evidence stops matching once a PR is rebased or squashed. With
`reuse: { scope: "inputs" }`, a check run through Vite+ is reused whenever the
files and env vars it read are unchanged, on any commit.

[Source](./.cloudflare/ci/actions.ts#symbol=inputsLint "source")

After the run, the writer asks Vite+ which files the check read and signs a
SHA-256 digest of each. A reader recomputes every digest in its own checkout. It
needs no Vite+ cache, only the `refs/notes/effect-ci-inputs` ref:

```sh
git fetch origin refs/notes/effect-ci-inputs:refs/notes/effect-ci-inputs
EFFECT_CI_CHECK_PUBLIC_KEY="$(cat public.pem)" \
  effect-ci run --workflow examples/verification-evidence/.cloudflare/ci/inputs.ts
```

The [test](./.cloudflare/ci/tests/input-evidence.test.ts) squashes a docs edit
into a new commit, then reuses the pass in a fresh clone. Changing `app/index.js`
runs the check again.

Limits:

- Only the writer's trace decides what counts as an input. Sign only runs of
  trusted code, such as `main`. The traced process could hide reads from fspy.
- A trace that saw no project files is never signed. On macOS, Vite+ cannot trace
  TypeScript 7's `tsc` ([vite-task#587](https://github.com/voidzero-dev/vite-task/issues/587)).
- Local checkouts only. Commands without a Vite+ trace always run.

[Actions](./.cloudflare/ci/actions.ts) · [Input evidence](../../packages/github/src/input-evidence.ts) ·
[Check-cache API](../../packages/github/src/check-cache.ts)

## cf ci comparison

[cf ci workflow](./.cloudflare/cf-ci/src/index.ts) repeats `node --check
app/index.js` on every run. Like GitHub Actions, it has no trusted store for
reusing a check. It does not use Effect CI.

```sh
(cd examples/verification-evidence/.cloudflare/cf-ci && npm ci)
node scripts/cf-ci.mjs verification-evidence
```

See [node-npm](../node-npm/README.md#cf-ci-comparison) for how the script
deploys the pipeline and checks the run.
