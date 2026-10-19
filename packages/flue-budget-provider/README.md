# Use Flue through a private inference budget

A standalone agent host imports this package, not another app's implementation.
It receives a private `FlueBudgetService` binding; it needs neither a raw Workers AI
binding nor GitHub credentials. The existing budget app remains the authority that
atomically reserves its fixed lifetime budget before inference.

The broker imports only the `./protocol` and `./policy` subpaths. These contain no
Flue runtime import; importing the provider barrel into the broker would execute
unneeded runtime initialization. Actual workerd startup tests guard this boundary.

```ts
import { budgetedFlueProvider } from "@effect-ci-testbed/flue-budget-provider";

const provider = budgetedFlueProvider(
  hostOwnedRun,
  env.REPAIR_AI,
  nextDurableHostOwnedReservationId,
  { proposalOnly: true },
);
```

Only the pinned Workers AI model is advertised. Gateway and paid fallback remain
disabled. The general request guard rejects tools and extra headers. The explicit
text-proposal policy recognizes and removes Flue 2.2.2's exact framework task
declaration, discards its well-formed affinity routing hint, and rejects model
tool calls before Flue receives the original stream. It grants no delegation,
shell, repository-write or deployment capability.

Run/reservation identity must come from trusted durable host state, never a model,
project, global counter or caller-supplied header. The package's failure latch is
in memory; it is **not** a durable retry policy. The broker's persisted request and
original-response receipts determine whether an identical call can be replayed.
Pending, failed or mismatched calls must not cause a new paid call automatically.

This extraction does not deploy or activate a hosted agent. Existing budget,
provider, negative lifecycle, text-proposal and restart tests in
`test/apps/repair-ai` now exercise this shared implementation. Local fake-model tests
are not native inference or end-to-end repair proof.
