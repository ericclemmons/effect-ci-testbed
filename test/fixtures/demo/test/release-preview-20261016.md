# Clear preview and threaded release — October 16, 2026 UTC

The app now displays its release message immediately, labels the editable content,
and provides **Test JavaScript** with an explicit browser result. The guide gives
a direct live link and concrete commands for the configured testbed; it no longer
asks a reader to expand App permissions to try that existing demo. Separate-repo
Cloudflare action/enrollment remains unfinished, not silently granted or verified.

PR #292 merged the UI/guide change as `111bc2ca7e522bf096efb0ef99cba3c23fd391bf`.
A normal merge preserved `demo/live`'s prior `867c7db` history and integrated main;
one genuine feature push of `e7179eccf60c82d6f0cbf57c5d7a880cc4bab108` created
native instance `3b9098e0-c8f9-11f1-9c69-5d488bf82d84`. No manual dispatch,
empty/cosmetic source, original-history reset, new credential or AI call was used.

## Actual acceptance

- Eleven build actions and nine Container commands completed once. The unsigned
  source executed the pure parser; this is not a new attestation/reuse claim.
- All twelve owned App GitHub checks independently succeeded.
- One maintained channel card, `1792110824.305079`, remained compact. Fifteen
  separately maintained non-broadcast replies held eleven steps and four reviews.
- Four real private PNGs and four normal signed-in built-in-browser Progress
  decisions were verified against consumed private decision records, matching
  snapshots and deadlines. These were explicitly delegated **test** approvals,
  not independent human review or automatic deadline acceptance.
- Candidate observations were 13/32/70/100, all with zero observed failures.
  Every verdict remained **uncertain** and was explicitly risk-accepted; no
  conclusive SLO or WOBS completeness claim is made.
- Candidate `7aa076d2-23c6-4550-b197-d7754d4ae7df` remains committed at 100% in
  deployment `19a606ed-2601-41d5-bd73-bac01d2bc2c5`. The captured prior version
  was `ef0d65a2-e720-4fa1-8806-93bb3bb4d585`, not the obsolete lab baseline.
  The successful path did not roll back or rewrite the prior release history.

The [production URL](https://effect-ci-hmd-demo.ericclemmons.workers.dev/)
returned 302 to this build's immutable Vite publication. Independent health
identity and all three raw asset hashes/sizes matched the native verifier:

| File         | Bytes | SHA-256                                                            |
| ------------ | ----: | ------------------------------------------------------------------ |
| `index.html` |   926 | `cea4ffa2f433cf5d086041a821bbef2f90f6af39df2d9da3bae56f145a78d230` |
| `app.js`     |  1660 | `a5bb1bb19ab1d75f07725b5a7d50c2b1a38de5dd56b5adc6b1dadc6eee642b4f` |
| `message.js` |   100 | `c9d95addba605e1fc6fff983591fbef245f4ae99d0f81356b9661bf7f3b343b0` |

Asset digest: `cbb7c3279acf7de80096837e389e7ad8cbcbb92fdafb76b9c9251407bda7419b`.
The actual browser showed **Hello from the demo app.** without a click, then
**JavaScript is working in this build.** after Test JavaScript, both on the pinned
preview and through the production redirect. The public screenshot contains only
the fixture. Slack screenshots and full actor/capability records remain private.
There is no new video, benchmark, arbitrary-repo enrollment or paid repair proof.

## Read-only revalidation

```sh
LIVE_DEMO_PREVIEW=1 LIVE_DEMO_PREVIEW_CURRENT=1 \
  CF_BIN=apps/effect-ci/node_modules/.bin/cf \
  node --test apps/effect-ci/src/live-demo-preview.test.ts
```

Omit CURRENT after a legitimate future release. The checks only read retained
history, existing version metadata/allocation and public HTTP bytes. Never
dispatch or replay a release merely to refresh this evidence. Private create-only
receipts preserve preflight/push, native history, observations, browser captures,
consumed decisions, GitHub results and independent acceptance.
