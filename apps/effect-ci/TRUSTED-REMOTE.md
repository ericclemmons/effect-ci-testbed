# Trusted remote CI → PR review

Local runs are feedback. The host signs verification. PR policy decides approval.

## Current host acceptance

The merged SDK fixes through `c08d06b` are deployed as Worker
`4448c514-fe56-4790-8111-159a8a89a17d`. Remote `doctor` passed without dispatch.
At commit `4496c99`, remote run `355940b2-919d-435c-ae10-8b9afe332340` built and
signed its workspace; `d207d477-13f0-41ff-b587-51233f803675` reused that same build
and verified the existing test receipt. Neither build nor test-suite commands
replayed on the second run. Signatures and original producer IDs were independently
verified. Installation and typechecking still ran; this is not blanket CI skipping.

The earlier remote-to-SCM and PR-approval proofs below remain separate retained runs.

## Earlier snapshot-reuse proof

Snapshot-reuse proof source: `ca90adf96ac5ffd8c5ef2e5254202f482ff9013b`.
Its Worker version: `55ff142f-752c-41da-82a4-7f7e7c6fd17b`.

## What ran

| Path | Result |
| --- | --- |
| Remote `test build`, same commit twice | First executed; second verified tests and restored the signed build snapshot |
| Agent remote → GitHub CI | SCM verified the same test receipt and reused the same build snapshot; neither command ran again |
| SCM publication | Published those checked bytes to a commit-pinned preview |
| [README PR #340](https://github.com/ericclemmons/effect-ci-testbed/pull/340) | App approved after remote verification; no model call |
| [Code PR #341](https://github.com/ericclemmons/effect-ci-testbed/pull/341) | Remote test/build passed; policy required independent review and submitted no approval |

The acceptance PRs target the feature branch for #339, not production. Neither
enables auto-merge. Eligibility does not replace GitHub's review requirements.
Code review currently falls back to normal review; no paid reviewer is configured.

A temporary review/check requirement on that feature branch confirmed the merge
gate: README was `APPROVED` / `CLEAN`; code was `REVIEW_REQUIRED` / `BLOCKED`.
The temporary rule was removed afterward. Main's rules were unchanged.

The remote-only runs did not publish or release. The branch's SCM run published
a preview, not a production candidate. Production and the separate Actions
runner allocations remained unchanged. No repair replay or model call occurred.

## Inspect

- [First remote run](https://dash.cloudflare.com/0db135ec469e2f216fcea26426f29755/workers/workflows/effect-ci-demo/instance/45c5cd9a-b3c1-49c7-a94f-73f4c2b48360)
- [Same-commit reuse](https://dash.cloudflare.com/0db135ec469e2f216fcea26426f29755/workers/workflows/effect-ci-demo/instance/cbcad0a8-16bf-468a-b0eb-52ce517fe308)
- [README remote verification](https://dash.cloudflare.com/0db135ec469e2f216fcea26426f29755/workers/workflows/effect-ci-demo/instance/f0fd267b-03f4-49e4-a313-f430b7158cdc)
- [SCM reuse and publication](https://dash.cloudflare.com/0db135ec469e2f216fcea26426f29755/workers/workflows/effect-ci-demo/instance/837af500-ca94-11f1-837e-3ff533395c7b)
- [Published preview](https://effect-ci-demo-site.ericclemmons.workers.dev/r/9f8fd26bb80cbc4705b53fb95b67effacd39a487/c16894ed915e5a6fc58f4b360cfd8d00f334b47ce1b3e5cc63cf7d05c844bcf6/index.html)

The SCM plan reports `test: verified` and `build: reused`. Its native history has
no test-suite or build command checkpoint. Both receipts retain the remote
producer's identity. An independent public-key verifier checked the signatures;
fetching the published HTML/JS reproduced the publication digest.

Read-only retained-proof check, using existing Cloudflare/GitHub sessions:

```sh
VERIFY_TRUSTED_REMOTE=1 node --test test/fixtures/demo/test/trusted-runner-proof.test.ts
```

This creates nothing and invokes no model. It is a maintainer check, not demo setup.
The fixture key below is public; the private signing key stays in the host DO.

## Approval is an action

`inspect PR → review → approve PR`

The [authored org workflow](./src/workflows/pull-request.ts) owns the rule. The
host supplies canonical evidence and a journaled exact-head writer, not a merge
capability. Each action has its own native checkpoint; planning makes no API calls.

- [Remote test/build](https://dash.cloudflare.com/0db135ec469e2f216fcea26426f29755/workers/workflows/effect-ci-demo/instance/c4a7cd1b-9a91-4c14-90c1-8c9783301846) signed the exact pushed commit.
- [PR #345 approval](https://github.com/ericclemmons/effect-ci-testbed/pull/345#pullrequestreview-5561282518) followed the real PR-open event, without a model.
- [Native actions](https://dash.cloudflare.com/0db135ec469e2f216fcea26426f29755/workers/workflows/effect-ci-small-change-review/instance/review-d1c741e0-caa4-11f1-867e-0072b079b97d-345) completed once each, with zero retries.

Proof head: `a11e97f292058f2edca46cf6d56f06098610aa00`.
Host source: `bddafc121abb97753fa85be6f0682f2390751cd4`.
Worker version: `a71e9181-f4b8-4af2-9fe6-6fa50b5f31d4`.

The acceptance PR is closed, unmerged. Production and the separate Actions runner
were unchanged. Earlier [PR #344](https://github.com/ericclemmons/effect-ci-testbed/pull/344)
retains its neutral result: the old 30-PR lookup undercounted author experience.
The corrected reader found ten real qualifying merges after examining 50; it
stops at 100 same-author file lists without lowering the ten-merge criterion.

## Limits

Exact committed inputs only. A changed commit, policy, runtime or unavailable
snapshot misses safely. Squash/rebase does not inherit another commit's evidence.
Build-result reuse binds the host version; a host rollout invalidates it.
The demo still enrolls a fixed test suite/build program, not arbitrary uploaded
workflow modules. [Policy and artifact contract](../../packages/cloudflare/src/trusted-runner-receipts.md).

When adding a container image, `--containers-rollout none` leaves deployed image
registration unchanged. This rollout required an explicit container update after
idle-controller checks; the original workspace image digest stayed unchanged.
