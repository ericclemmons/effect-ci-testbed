# Build and serve a static site without a container

Build a small interactive site in a Dynamic Worker and serve its output without
starting a container.

The pipeline reads five commit-pinned files, runs the project's template builder
in an isolated Worker, and publishes HTML, CSS, and JavaScript as an immutable
revision. A separate Worker serves that revision.

The snippets on this page come from this example's files, which CI runs end to
end.

## Try the site

[Open the example](https://effect-ci-containerless-site.ericclemmons.workers.dev/r/cf6dd38f2cbb6e89840fb7dc75b6ee681c5eb3c0/index.html)
and click the counter.

## Write the template builder

The project's builder is a Worker module. It receives the source files as JSON
and returns the built assets:

[`site/build.js`](./site/build.js "source")

## Define the workflow against a host service

Create `.cloudflare/ci/workflow.ts`. The actions call a `SiteHost` service
instead of running commands, so the workflow needs no container. Declare the
service first:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts#L1-L13 "source")

Then chain checkout, build, publish, and verify. During planning, each action
returns an empty value instead of calling the host:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts#L14-L53 "source")

## Build in a Dynamic Worker

In `src/site.ts`, `buildSite` loads the project's builder into a child Worker
with no network access, no bindings, and CPU and time limits:

[`src/site.ts`](./src/site.ts#symbol=buildSite "source 'globalOutbound: null' 'subRequests: 0'")

## Provide the host in the Workflow

In `src/worker.ts`, the Workflow entrypoint provides `SiteHost`. Each operation
runs as a recorded Workflow step. Checkout and publish go through the
`SiteRevisions` Durable Object, which stores immutable revisions:

[`src/worker.ts`](./src/worker.ts#symbol=ContainerlessSiteWorkflow "source 'Effect.provideService(SiteHost' 'No container execution capability'")

The default export serves a published revision at `/r/<commit>/<file>`:

[`src/worker.ts`](./src/worker.ts#symbol=default "source")

## Configure the Worker

`cloudflare.config.ts` binds the Worker Loader and exports the Durable Object and
the Workflow:

[`cloudflare.config.ts`](./cloudflare.config.ts "source")

## Deploy your own

Adapt the fixed repository and resource names in
[the Worker](./src/worker.ts), [the source checkout](./src/site.ts),
and [configuration](./cloudflare.config.ts), then:

```sh
cd examples/containerless-site
cf deploy
cf workflows instances create effect-ci-containerless-site-build --body '{"instance_id":"my-site-run","params":{"revision":"FULL_40_CHARACTER_COMMIT"}}'
```

The run returns a revision-specific URL. Older URLs retain their original bytes.

## Run it locally

```sh
pnpm --filter @effect-ci-testbed/containerless-site dev
pnpm --filter @effect-ci-testbed/containerless-site exec wrangler workflows trigger effect-ci-containerless-site-build '{"revision":"FULL_40_CHARACTER_COMMIT"}' --local
```

`wrangler dev` runs the same Worker, Dynamic Worker build, Durable Object and
Workflow without Docker. The [local configuration](./wrangler.jsonc) verifies the
revision served at `http://localhost:8787`. It is not a deployment config.

This is a bounded JavaScript template build, not npm installation or arbitrary
Vite support. [Static Assets](../static-assets-source) uses Cloudflare's Assets
upload API instead of a Dynamic Worker/DO-backed site.
