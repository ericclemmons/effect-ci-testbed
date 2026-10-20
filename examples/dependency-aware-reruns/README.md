# Rerun only affected checks

Rerun the failed action and its consumers—not every successful check.

Dependencies come from actions yielding other actions. In this example:

- Rerun `test`: execute test and build; reuse lint and format.
- Rerun `install`: execute all checks and build; reuse checkout.
- Rerun optional `format`: execute format only.

## Run it

```sh
pnpm exec cf-ci run --workflow examples/dependency-aware-reruns/.cloudflare/ci/workflow.ts
```

Read the [workflow](./.cloudflare/ci/workflow.ts) and
[rerun examples](./.cloudflare/ci/tests/dependency-aware-reruns.test.ts).
[Immutable attempts](../immutable-attempts) shows how to create the next run
without changing the previous one.
