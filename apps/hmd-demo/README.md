# Health-mediated release test target

Dedicated test Worker, not a production application. Its only route is `/health`,
which reports the executing `WORKER_METADATA.id` and emits a structured `hmd`
outcome to Workers Logs. There are no credentials or administrative endpoints.
The health route is deliberately public to generate test traffic.

```sh
pnpm --filter @effect-ci-testbed/hmd-demo exec cf build
# From apps/hmd-demo:
cf deploy --prebuilt
```

The default profile always succeeds. To build a deliberately failing candidate:

```sh
HMD_DEMO_FAILURE_RATE=1 pnpm --filter @effect-ci-testbed/hmd-demo exec cf build
# Upload from apps/hmd-demo; DO NOT deploy the failing profile:
cf workers versions create --prebuilt --tag hmd-regression
```

Uploading a candidate must leave the existing deployment allocation unchanged.
Fractional failure rates support intermediate test profiles. Version metadata is
not a traffic percentage: the release controller must read the actual deployment
allocation and retain it for rollback. Do not infer percentages from sampled logs.

`headSamplingRate: 1` asks the Worker to retain its logs, but is not a guarantee that
the Analytics SQL service returns an unsampled population. The health gate must
still inspect dataset sampling semantics and completeness.

See the [HMD example](../../examples/health-mediated-release) for gate semantics
and the remaining real rollout verification matrix.

## Bounded live regression test

From the repository root, with `cf` authenticated:

```sh
HMD_LIVE=1 node --test apps/hmd-demo/ci/tests/live-rollback.test.ts
```

This is opt-in and skipped by default. It targets only this dedicated Worker and
the recorded versions, requires the known healthy 100% baseline, briefly assigns
10% to the failing candidate, and issues at most 400 requests in batches of five.
The `finally` block restores the entire prior allocation and verifies healthy
responses. Do not run it concurrently with another operator. Its deployment-ID
check refuses to overwrite a newer deployment but is not atomic production
ownership protection. Failed or ambiguous mutation responses need operator review;
the CLI does not automatically retry a deployment write.

Verified 2026-10-10 UTC:

- Previous deployment: `bfe54ed8-5cfb-4fb6-b296-15c27ee186b8`.
- 10% regression deployment: `42dfc529-0cfe-4e51-8f64-0ad0f4bee42c`.
- Direct HTTP candidate observations: 20/20 failed; anytime-valid error-rate bounds
  `[45.7%, 100%]`, conclusively above the configured 10% absolute SLO.
- The *difference* interval still overlapped the regression budget; the absolute
  SLO breach, not a claimed causal comparison, caused the rollback decision.
- Restored deployment: `c2641646-4ee8-4edf-b77b-8d426fd449ff`, 100% healthy baseline.

These direct probes are a controlled test workload, not production traffic or
WOBS observations. Native SQL version attribution is verified separately; complete
WOBS cohorts, hosted retry orchestration, healthy promotion through all phases,
and live Slack/GitHub charts remain to be integrated.
