# Select dependency-aware reruns

This example answers one question:

> If one action is rerun, which successful actions can Effect CI safely reuse?

Effect CI uses the workflow plan's explicit `needs` edges. It reruns the requested
action and its transitive dependents, while preserving unrelated siblings. An `after`
edge controls ordering only, so it does not invalidate later work.

Run the workflow locally:

```sh
./examples/dependency-aware-reruns/.cloudflare/ci/workflow.ts
```

The rerun-selection assertions live separately in
[`ci/tests/dependency-aware-reruns.test.ts`](./.cloudflare/ci/tests/dependency-aware-reruns.test.ts).

The example proves these cases:

- rerun `test` → rerun `test` and `build`; reuse `lint` and `format`
- rerun `install` → rerun all checks and `build`; reuse `checkout`
- rerun optional `format` → rerun only `format`

This example is deliberately only the selection primitive, so GitHub and Cloudflare
rerun adapters remain roadmap work. See
[`immutable-attempts`](../immutable-attempts) for creating a new attempt, restoring
reusable node outputs, and executing the selected subgraph without changing history.
