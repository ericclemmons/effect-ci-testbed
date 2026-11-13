# Rerun only affected checks

Rerun the failed action and its consumers—not every successful check.

Effect CI learns dependencies from actions yielding other actions. You do not
declare a separate dependency graph. In this example:

- Rerun `test`: execute test and build; reuse lint and format.
- Rerun `install`: execute all checks and build; reuse checkout.
- Rerun optional `format`: execute format only.

The snippets on this page come from this example's files, which CI runs end to
end.

## Define the actions

Create `.cloudflare/ci/actions.ts`. Start with the SDK import:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#L1 "source")

Check out the source first:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=checkout "source")

`install` depends on `checkout` because it yields it:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=install "source 'yield* checkout()'")

Each check yields `install`, so a rerun of `install` also reruns every check:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=lint "source 'yield* install()'")

`format`, `test`, and `build` follow the same shape:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=test "source")

## Define the workflow

Create `.cloudflare/ci/workflow.ts`. Lint and the optional format check run in
parallel, then test, then build. Build runs after test, so rerunning `test` also
reruns `build`:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source {6-10}")

## Plan a rerun

`CI.planRerun` takes a workflow plan and the actions to rerun. It returns the
actions to execute again and the actions to reuse. The example's test checks
each case above:

[`.cloudflare/ci/tests/dependency-aware-reruns.test.ts`](./.cloudflare/ci/tests/dependency-aware-reruns.test.ts#L6-L15 "source")

An unknown action name fails with `CI.WorkflowPlanError`:

[`.cloudflare/ci/tests/dependency-aware-reruns.test.ts`](./.cloudflare/ci/tests/dependency-aware-reruns.test.ts#L29-L33 "source")

[Immutable attempts](../immutable-attempts) shows how to create the next run
without changing the previous one.

## Run it

```sh
cd examples/dependency-aware-reruns
effect-ci run
```

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
