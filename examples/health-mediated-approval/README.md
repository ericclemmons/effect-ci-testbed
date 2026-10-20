# Review a rollout when health is uncertain

Ask a human when a health check cannot decide—but never let approval override a
confirmed regression.

```text
healthy → advance
uncertain → request review
regression, rejection, or expired review → roll back
```

The reviewer accepts risk for one fixed health snapshot and phase. Approval does
not relabel uncertain health as healthy. A new phase needs a new decision.

## Explore the policy

The [controller](../../test/apps/example-runner/src/hmd-review-controller.ts)
adds a bounded review wait to [automatic health gating](../health-mediated-release).
Its administrative lab uses version-attributed HTTP probes against a dedicated
target and restores the baseline after completion.

Slack approval is not connected to this standalone recipe. See the
[Slack release example](../cloudflare-hitl-release) for the approval integration.
