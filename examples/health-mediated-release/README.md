# Release a Worker only while its health remains acceptable

> How do I upload a candidate without releasing it, progressively shift traffic, and roll back on a confirmed regression?

```mermaid
flowchart LR
  upload["upload candidate version"] --> release10["release 10%"]
  release10 --> health10["health gate"] --> release25["release 25%"]
  release25 --> health25["health gate"] --> release75["release 75%"]
  release75 --> health75["health gate"] --> release100["release 100%"]
  release100 --> health100["health gate"]
  health10 -. unhealthy or exhausted .-> rollback["restore prior traffic split"]
  health25 -. unhealthy or exhausted .-> rollback
  health75 -. unhealthy or exhausted .-> rollback
  health100 -. unhealthy or exhausted .-> rollback
```

---

Integration in progress; no complete progressive release is verified here yet.

Implemented foundations:

- [Dedicated demo Worker](../../apps/hmd-demo) with version-tagged healthy/failing profiles.
- [Health gate](../../packages/cloudflare/src/health-gate.ts) and tests for uncertainty,
  progression, regression, wrong cohorts, incomplete data, and sampled counts.
- [Historical confidence-envelope SVG renderer](../../packages/cloudflare/src/health-chart.ts).
- [Pure release policy](../../packages/cloudflare/src/release-policy.ts), preserving
  the previous multi-version split, bounding observations per phase, and requiring
  a health gate after 100% as well as intermediate phases.
- A host-only Analytics SQL availability probe; no analytics token enters a container.

The chart is an observed-data confidence envelope, not a forecast cone. The initial
binary-error estimator uses conservative anytime-valid Hoeffding bounds, allocating
the release's error budget across both cohorts, all sample counts, and configured
phase × metric comparisons. It assumes independent Bernoulli observations within
each cohort; correlated requests or repeated retries are not independent trials.
It does not interpret weighted SQL `COUNT(*)` values as a binomial sample size.
Sampled datasets remain uncertain until a justified sampling-aware estimator is
provided. A previous-time-window comparison also cannot establish causality when
the traffic mix changes; a simultaneous control cohort is a later stronger option.

Each gate pins the baseline version/window and candidate's phase start. The data
adapter must supply a closed ingestion watermark—query time is not that watermark.
Graphs can narrow as independent observations accumulate, but are not forced to
monotonically narrow or to declare success when data is absent.

`deploy` uploads an immutable Worker version without changing traffic. `release`
owns promotion and its reversal, capturing the previous deployment's complete
version/percentage mapping before any change. Rollback restores that mapping,
not the candidate's filesystem snapshot.

Each phase queries version-specific health observations collected after that phase
began. The release layer distinguishes three outcomes:

- **Healthy:** enough data and acceptable error rate; advance immediately.
- **Inconclusive:** insufficient or delayed data; throw a tagged retryable error
  containing the sample, then retry with a bounded one-minute delay.
- **Unhealthy:** conclusive threshold breach; throw a Cloudflare non-retryable
  error, then run the release action's rollback immediately.

Ten retries are a maximum observation budget, not a mandatory ten-minute soak.
Exhausting that budget fails closed and rolls back; missing analytics must never
mean healthy. Late samples and aggregate errors from an old version must not
trigger decisions for the new candidate. Concurrent releases need an ownership
guard so one rollback cannot overwrite another operator's deployment.

Cloudflare's [Analytics SQL binding](https://developers.cloudflare.com/analytics/sql-api/workers-binding/)
can query account-scoped datasets without injecting an API token into a container.
The [version metadata binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/version-metadata/)
provides the version identity for telemetry. Native
[Workflow retries and non-retryable errors](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/)
provide the health gate's timing semantics.

Verification must cover a real dedicated demo Worker: successful promotion,
inconclusive samples followed by enough data, immediate unhealthy rollback,
observation-budget exhaustion, and preservation of the prior traffic allocation.
Local tests can use deterministic health samples, but they do not earn a hosted ✅.

## Verification and notification work remaining

A bounded [live regression test](../../apps/hmd-demo/ci/tests/live-rollback.test.ts)
has shifted the dedicated demo to 10% failing candidate, classified a real SLO
breach from version-attributed HTTP probes, and restored its exact previous
allocation. This proves the deployment API path, not a complete hosted controller
or WOBS ingestion/health adapter. Its ownership check is advisory, not an atomic
lock against external operators. The example remains 🔜.

1. Upload healthy and failing candidate versions without shifting traffic; record
   the entire previous version allocation and protect it with release ownership.
2. Generate bounded traffic against the dedicated target, verify version attribution
   and sample weights through the real SQL binding, and account for ingestion lag.
3. Run each real 10/25/75/100 phase with an uncertainty budget. A regression is
   non-retryable; inconclusive data is retryable; exhaustion restores the prior split.
4. Publish versioned chart snapshots and update the **same** Slack message and GitHub
   check after each sample. An immutable sample history must survive retries. Slack
   image delivery/PNG rendering and secure chart URLs are not implemented yet.
5. Prove healthy promotion, regression rollback, inconclusive-to-conclusive progress,
   exhausted rollback, and concurrent-release ownership protection end-to-end.

For cron/Workflow SLIs, count logical **terminal runs**, not log lines or retries.
A deployment-caused DO reset followed by successful retry is not an application
failure. Unknown reset causes must not be blanket-ignored; terminal failure or a
missed execution deadline remains a separate availability signal. A daily cron with
no completed runs has no success evidence: remain uncertain, use a suitably long
observation budget, or require a safe representative trigger. A minute-frequency
cron still needs deduplicated run identity, version attribution, and retry completion.
Worker HTTP error rate, terminal Workflow failure rate, and cron lateness are
separate SLIs—not interchangeable denominators. Custom continuous metrics such as
latency require their own estimator; this first gate handles binary outcomes only.
