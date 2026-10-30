# Customize or disable caching

Keep cache storage policy out of the actions that do the work.

[Source](./src/worker.ts#symbol=EffectCIWorkflow "source")

Pass `cache: false` to disable it. The GitHub adapter maps the equivalent policy
to `actions/cache`; Cloudflare preserves the selected paths through snapshots.

## Run it twice

```sh
cd examples/cache-policy
effect-ci run
effect-ci run
```

The first build creates cached output. The next reports a hit. Change
`app/src/input.txt` to invalidate it.

[Workflow](./.cloudflare/ci/workflow.ts) · [Runner](./src/worker.ts)
