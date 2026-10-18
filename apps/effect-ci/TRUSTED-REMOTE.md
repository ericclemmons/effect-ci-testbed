# Trusted remote CI → PR review

Local runs are feedback. The host signs verification. PR policy decides approval.

Deployed source: `ca90adf96ac5ffd8c5ef2e5254202f482ff9013b`.
Worker version: `55ff142f-752c-41da-82a4-7f7e7c6fd17b`.

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
VERIFY_TRUSTED_REMOTE=1 node --test examples/demo/verification/trusted-runner-proof.test.ts
```

This creates nothing and invokes no model. It is a maintainer check, not demo setup.
The fixture key below is public; the private signing key stays in the host DO.

## Limits

Exact committed inputs only. A changed commit, policy, runtime or unavailable
snapshot misses safely. Squash/rebase does not inherit another commit's evidence.
Build-result reuse binds the host version; a host rollout invalidates it.
The demo still enrolls a fixed test suite/build program, not arbitrary uploaded
workflow modules. [Policy and artifact contract](../../packages/cloudflare/src/trusted-runner-receipts.md).

When adding a container image, `--containers-rollout none` leaves deployed image
registration unchanged. This rollout required an explicit container update after
idle-controller checks; the original workspace image digest stayed unchanged.
