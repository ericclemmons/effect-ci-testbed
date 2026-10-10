# Retry a flaky test

> How do I prove a transient first-attempt failure is retried and the second attempt passes?

```mermaid
flowchart LR
  step_flaky_test["flaky test"]
```

---

The check fails deliberately when `CI.Attempt` is `1`; attempt `2` succeeds.
Its retry policy allows one retry after one second. The local interpreter applies
the policy; the Cloudflare interpreter passes it to native `step.do`. No module
counter or container marker decides the attempt, so Worker restarts do not reset
the retry decision. This is a deterministic validation example, not advice to
hide genuinely flaky tests.

```sh
cf-ci run --workflow examples/retry/.cloudflare/ci/workflow.ts
node --test examples/retry/.cloudflare/ci/tests/retry.test.ts
```

Deploy the [example host](../../apps/example-runner), then execute the native check:

```sh
cf workflows instances create effect-ci-example-retry --body '{"instance_id":"my-retry-run","params":{"repository":"https://github.com/OWNER/REPO.git","revision":"FULL_COMMIT_SHA"}}'
```

There is no checkout or container in this workflow. The native history should show
one failed attempt, a one-second retry delay, and one successful attempt in the
same logical check. [Execution policies](../execution-policy) also cover exhaustion
and timeouts.
