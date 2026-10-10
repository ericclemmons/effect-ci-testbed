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
