# Customize or disable caching

Keep cache storage policy out of the actions that do the work.

[Source](./src/worker.ts#symbol=EffectCIWorkflow "source")

Vite+, Turbo and package download caches are discovered automatically by default.
Supply paths only for custom cache locations, or pass `cache: false` to disable
transport. GitHub Actions preserves the selected paths with `actions/cache`;
Cloudflare transports them through snapshots. Task tools still decide cache hits.

## Run it twice

```sh
cd examples/cache-policy
effect-ci run
effect-ci run
```

The first build creates cached output. The next reports a hit. Change
`app/src/input.txt` to invalidate it.

[Workflow](./.cloudflare/ci/workflow.ts) · [Runner](./src/worker.ts)
