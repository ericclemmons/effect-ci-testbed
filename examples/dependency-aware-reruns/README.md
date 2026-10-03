# Select dependency-aware reruns

This example answers one question:

> If one action is rerun, which successful actions can Effect CI safely reuse?

Effect CI uses the workflow plan's explicit `needs` edges. It reruns the requested
action and its transitive dependents, while preserving unrelated siblings. An `after`
edge controls ordering only, so it does not invalidate later work.

Run the executable verification:

```sh
node --import tsx examples/dependency-aware-reruns/verify.ts
```

The example proves these cases:

- rerun `test` → rerun `test` and `build`; reuse `lint` and `format`
- rerun `install` → rerun all checks and `build`; reuse `checkout`
- rerun optional `format` → rerun only `format`

This is deliberately the selection primitive, not attempt persistence. A later slice
will create a new immutable attempt, restore reusable node checkpoints, and execute
the selected subgraph in a new Cloudflare Workflow instance.
