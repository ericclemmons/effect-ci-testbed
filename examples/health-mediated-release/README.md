# Roll out a Worker with health checks

Shift traffic gradually and restore the previous allocation if the new version
regresses.

```text
upload candidate → 10% → 25% → 75% → 100%
                   health checks at every phase
```

The [release policy](../../packages/cloudflare/src/release-policy.ts) distinguishes:

- Healthy: advance.
- Inconclusive: wait for more data, within a bounded observation budget.
- Unhealthy or exhausted: restore the previous traffic split.

Upload does not release traffic. The release action owns promotion and rollback,
including the health check after reaching 100%.

## Explore the policy

[Health gate](../../packages/cloudflare/src/health-gate.ts) ·
[Hosted controller](../../test/apps/example-runner/src/hmd-controller.ts) ·
[Dedicated demo Worker](../../test/apps/hmd-demo)

The hosted lab uses dedicated targets and restores its baseline afterward.
It is not a general production rollout installer. Complete healthy rollout using
native production telemetry is still being connected.

Use [human review](../health-mediated-approval) when uncertainty should pause
for a decision rather than roll back automatically.
