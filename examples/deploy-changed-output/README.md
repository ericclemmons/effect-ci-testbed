# Deploy only changed build output

A shared package changed, but the app did not. Should it deploy?
Compare the rebuilt output, not just the app's source files.

The snippets on this page come from this example's files, which CI runs end to
end. All of them live in one file, `.cloudflare/ci/workflow.ts`.

## Choose a deployment destination

Start with the imports. The directory adapter ships with the SDK:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts#L1-L3 "source")

Create the destination. `paths` lists the build output to deploy:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts#symbol=destination "source {3}")

This example copies `dist` to a local directory. The
[directory adapter](../../packages/ci/src/directory-deployment.md) compares paths,
bytes, executable bits, and destination configuration. Failed builds or
publication do not advance the last-successful baseline.

## Define the actions

Check out the source, then build the app in its `app` directory:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts#symbol=checkout "source")

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts#symbol=build "source")

Publish the built workspace to the destination:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts#symbol=deploy "source 'destination.publish(workspace)'")

## Compare output with the last deployment

Tell local runs to compare workspace changes against the destination's last
successful deployment:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts#symbol=local "source")

The workflow builds, then deploys only when `dist/**` differs from that
baseline:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts#symbol=default "source {3}")

## Try it

```sh
cd examples/deploy-changed-output
effect-ci run
effect-ci run
```

The first run publishes; the second skips deployment. Edit
[packages/greeting/message.mjs](./packages/greeting/message.mjs) and run again.
The importing app's HTML changes, so it publishes once more.

## Compare with GitHub Actions

The [GitHub Actions comparison](./.github/workflows/github.yml) has no deployment
baseline, so it keys a cache entry on the built output's hash. That records that
an output deployed once, not what is deployed now:

[`.github/workflows/github.yml`](./.github/workflows/github.yml#L24-L43 "source")

See also [Vite+ build caching](../vite-plus-cache).
