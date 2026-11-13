# Publish static assets without a container

Publish commit-pinned HTML, CSS, and JavaScript through Workers Static Assets.
Optionally compile a small TypeScript entrypoint in an isolated Worker first.

```text
read source → compile when needed → upload assets → deploy → check the site
```

The snippets on this page come from this example's files, which CI runs end to
end.

## Try the site

[Open the example](https://effect-ci-static-assets-demo.ericclemmons.workers.dev/)
and click **Verify compiled JavaScript**.

## Define the workflow

Create `.cloudflare/ci/workflow.ts`. Each action asks the `StaticAssets` host
service for one step: capture the pinned source, upload and deploy it, then
check the served site. In plan mode the actions return placeholders and make no
calls:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source")

The workflow supports `publish` for the three `site/` files and `build` for the
three `build-site/` files.

## Provide the host service

The host is a Cloudflare Workflow, [`src/worker.ts`](./src/worker.ts). It runs
the Effect CI workflow with its own `StaticAssets` implementation, provided with
`Effect.provideService`. Its executor refuses every command, so no container
starts:

[No container executor](./src/worker.ts#L94-L95 "source 'Static publication has no Container capability'")

In `publish` mode, capture reads the exact commit with the private source reader
and records it in the durable journal:

[Capture pinned source](./src/worker.ts#L70-L77 "source")

Publication uploads and deploys to the fixed target with the host-held
credential. Verification waits one fixed interval, then checks the served bytes:

[Upload, deploy, and verify](./src/worker.ts#L79-L93 "source 'publishStaticAssets' 'verifyStaticAssets'")

Configure the broker Worker with the source reader, a Worker Loader for the
compiler, the journal, and the Workflow:

[`cloudflare.config.ts`](./cloudflare.config.ts "source")

## Bounded build

In `build` mode, capture checkpoints the authenticated raw source before
compiling it. It then compiles the TypeScript entrypoint with
`buildStaticTypeScript` in a fresh Dynamic Worker and stores the build
provenance:

[Capture and compile](./src/worker.ts#L49-L68 "source 'buildStaticTypeScript'")

The compiled entrypoint is ordinary browser TypeScript:

[`build-site/app.ts`](./build-site/app.ts "source")

Compilation uses pinned Sucrase, not a general Vite/npm toolchain. See
[the bounded TypeScript build transform](../../packages/cloudflare-dynamic-worker/STATIC_BUILD.md).

## Run it

With the private publisher already configured:

```sh
cf workflows instances create effect-ci-static-assets-publish --body '{"instance_id":"my-static-build-run","params":{"mode":"build","revision":"FULL_40_CHARACTER_COMMIT"}}'
```

There is no local run: the recipe exists to exercise Cloudflare's Assets upload
and deployment APIs with a host-held credential, and those APIs have no local equivalent.
The compiler and publisher policies have offline tests.

## Use it in your own installation

The current publisher is scoped to the testbed and its dedicated target.
For your own installation, configure the repository reader, target Worker and
host-held deployment credential; see [setup and authority](./AUTHORITY.md).
The compiler never receives that credential.

Source revisions are immutable. If publication acknowledgement is uncertain,
inspect the existing operation rather than upload again.
