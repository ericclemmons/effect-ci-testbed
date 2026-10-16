# Normal main deployment — October 16, 2026 UTC

Normal merge `535ef4153612b6e850f6ab57e50b50e260f523cf` triggered native run
`1402d960-c925-11f1-8d1a-09e28c4c90fb` from `refs/heads/main`. No manual dispatch,
special push refspec, new error, inference or repair replay was used.

Eleven actions, nine commands, four two-minute settling intervals and four real
private charts completed once. One Slack root `1792129654.377089` retained its
latest chart; fifteen maintained replies held step evidence and review controls.
All twelve checks associated with this exact native run succeeded. Check readback
paginates and selects the exact Dashboard instance, not unrelated checks sharing
the same main commit.

Candidate cohorts were 12/21/74/100, each with zero observed failures. All verdicts
remained **uncertain**. Four normal signed-in browser decisions were explicitly
delegated TEST risk acceptance, not independent human review or a conclusive SLO.
The final decision committed candidate `24e0ff19-3c7a-4673-b300-cb2bf5374a29` at
100%, deployment `48160a78-e72a-4b67-824e-45203c02d5fb`; the captured prior version
was `7aa076d2-23c6-4550-b197-d7754d4ae7df`. Success did not restore an older build.

Independent GETs verified all three native build hashes/sizes, production redirect
and health identity. A real browser verified the message and JavaScript interaction,
but exposed a presentation failure: the serving CSP blocked the app's inline Kumo
styles. Byte equality alone did not prove rendering. The follow-up derives bounded
exact style hashes from immutable HTML, without `unsafe-inline` or script/network
permission changes. Until that serving fix is deployed and visually checked,
the Kumo rendering is not accepted. The unstyled screenshot stays in private
failure evidence, not as a successful public feature image.

An earlier main run `c6c016d0-c920-11f1-84a3-ccb51670aff6` failed after its promotion
POST succeeded but immediate acknowledgement was ambiguous. Its history remains
errored. GET-only reconciliation of that SAME intent, then an explicit broker
rollback, restored its captured prior allocation before this new main event.
The broker now permits only bounded GET confirmation while reads exactly match
the pre-write deployment; no deployment POST retry was added. Delayed visibility
is an inference, not a proven platform root cause.

```sh
LIVE_MAIN_RELEASE=1 LIVE_MAIN_RELEASE_CURRENT=1 \
  CF_BIN=apps/effect-ci/node_modules/.bin/cf \
  node --test apps/effect-ci/src/live-main-release.test.ts
```

GET-only. Omit CURRENT after a legitimate newer release; never replay a completed
operation to refresh proof. Historical syntax-only attestation, test-suite reuse,
strict WOBS completeness and arbitrary-repository onboarding are separate claims.
