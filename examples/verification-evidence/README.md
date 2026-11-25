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

## Survive rebases and squashes

Commit evidence stops matching once a PR is rebased or squashed. By default,
`reuse: true` reuses a check run through Vite+ whenever the files and env vars
it read are unchanged, on any commit. The check above opts into
`{ scope: "commit" }` instead.

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
  TypeScript 7.0's `tsc` ([vite-task#587](https://github.com/voidzero-dev/vite-task/issues/587));
  use TypeScript 7.1 (`typescript@beta` until it is stable).
- Local checkouts only. Commands without a Vite+ trace always run.

[Input evidence](../../packages/github/src/input-evidence.ts#symbol=inputEvidenceCheckCache "source")

## Compare with GitHub Actions

Conventional GitHub Actions reruns the check every time:

[GitHub Actions comparison](./.github/workflows/github.yml#L11-L17 "source")
