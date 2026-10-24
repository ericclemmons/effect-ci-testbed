# Matrix and test-splitting execution evidence

Source: `781352d83fdd1a8f78f46e993ea4e35678dbe7a7`.

The [native GitHub run](https://github.com/ericclemmons/effect-ci-testbed/actions/runs/40061626649)
completed all eleven jobs successfully on Ubuntu runners:

| Recipe | Assertions |
| --- | --- |
| [Matrix](./matrix) | Four native jobs checked every locale × currency combination. |
| [Test splitting](./test-splitting) | Two native jobs produced reports whose union contains all six files exactly once; assignments match the deterministic splitter. |
| [Timing-aware splitting](./timing-aware-splitting) | Two native jobs produced complete reports; aggregation recorded durations; a later Effect workflow downloaded that history, ran the suite, and matched its assignments against the prior durations. |

The timing run retained [raw before/after history and warm reports](./timing-aware-splitting/verification/github-2026-10-24.json).
Durations are wall-clock milliseconds including Node process startup. They demonstrate
the measurement/assignment feedback loop, not a performance benchmark or guaranteed
speedup. The native warm run changed the shard assignments while retaining all six files.

The [recipe CI run](https://github.com/ericclemmons/effect-ci-testbed/actions/runs/40061626631)
also exercised each unchanged Effect workflow through the GitHub runner adapter.
All three recipes' plan/execute adapter jobs passed. Its first conventional timing
comparison failed during Node installation under `act`: matrix variants shared a
Node tool cache. The comparison workflows now isolate that cache per matrix combination
under `act`; native GitHub runners already provide separate filesystems.

Local verification on macOS with Node 24.22.1 included all ten recipe assertions,
all three real CLI entrypoints, intentional CLI failures, cold/warm timing assignment
checks, preservation of history after failure, and the repository-wide `pnpm check`.
Cloudflare execution and per-file JUnit ingestion are outside this proof. The GitHub
warm run transfers history through a workflow artifact; cross-run cache restoration
in the standalone comparison is a separate path.
