# Rerun only affected checks

Rerun the failed action and its consumers—not every successful check.

Dependencies come from actions yielding other actions. In this example:

- Rerun `test`: execute test and build; reuse lint and format.
- Rerun `install`: execute all checks and build; reuse checkout.
- Rerun optional `format`: execute format only.

## Run it

```sh
cd examples/dependency-aware-reruns
effect-ci run
```

Read the [workflow](./.cloudflare/ci/workflow.ts) and
[rerun examples](./.cloudflare/ci/tests/dependency-aware-reruns.test.ts).
[Immutable attempts](../immutable-attempts) shows how to create the next run
without changing the previous one.

## cf ci comparison

[cf ci workflow](./.cloudflare/cf-ci/src/index.ts) runs the seven comparison
scenarios in parallel. Each scenario runs the prepare, selected rerun, and
verify steps in one container, because they share runner-local files. It does
not use Effect CI.

```sh
(cd examples/dependency-aware-reruns/.cloudflare/cf-ci && npm ci)
node scripts/cf-ci.mjs dependency-aware-reruns
```

See [node-npm](../node-npm/README.md#cf-ci-comparison) for how the script
deploys the pipeline and checks the run.
