# Local verification

Run October 26, 2026 (America/Chicago), against landed baseline `20f2910` plus
this branch's working changes. Node 24.22.1; no hosted deployment or Slack send.

`node examples/actionable-lifecycle/demo.ts` performed six local scenarios:

| Scenario | Observed result |
| --- | --- |
| Retry | Dependency wait, failure, 20 ms configured backoff, second execution, actual source hashing, success |
| Business failure | Failure, not cancellation or rollback |
| Cancellation | Effect timer interrupted after execution began; cancelled terminal event and card |
| Compensation | Rollback requested, local compensation executed, rollback completed; original business failure preserved |
| Failed compensation | Rollback requested, local compensation failed, rollback failure preserved |
| Automated decision rejection | Awaiting authorized decision, configured local policy rejected, business failure; not a human click |

All six terminal cards rejected replay of their earlier captured execution event.
Queue and startup measurements remained `null`. One representative run measured
21 ms retry wait, 1 ms evidence collection, 21 ms interrupted execution, and
11 ms automated decision wait. These are local observations, not benchmarks or
hosted admission/compute/decision claims. Re-running changes the measurements.

CLI plan and execution both ran through `packages/cli/src/bin.ts`; planning
emitted no execution lifecycle phases. Text execution displayed the dependency,
retry, evidence and terminal phases without duplicated execution phase lines.

Existing runtime, compensation, observer, card and notification-service suites:
86 tests passed, including CLI and nested-event coverage. No test source was
added or changed. The affected packages and this recipe also passed TypeScript
checks. `pnpm check` passed, including all recipe plans and 17 documentation and
ergonomics checks. `pnpm docs:build` passed and verified 93 README routes, source
snippets, internal page links and search assets. See the lifecycle contract
for the still-open identity integration and native-provider evidence boundaries.
