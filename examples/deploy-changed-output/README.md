# Deploy only changed build output

A shared package changed, but the app did not. Should it deploy?
Compare the rebuilt output, not just the app's source files.

```ts
const workspace = yield* build()
if (yield* workspace.changed("dist/**")) yield* deploy()
```

## Try it

```sh
pnpm exec cf-ci run --workflow examples/deploy-changed-output/.cloudflare/ci/workflow.ts
pnpm exec cf-ci run --workflow examples/deploy-changed-output/.cloudflare/ci/workflow.ts
```

The first run publishes; the second skips deployment. Edit
[packages/greeting/message.mjs](./packages/greeting/message.mjs) and run again.
The importing app's HTML changes, so it publishes once more.

This example copies `dist` to a local directory. The
[directory adapter](../../packages/ci/src/directory-deployment.md) compares paths,
bytes, executable bits, and destination configuration. Failed builds or
publication do not advance the last-successful baseline.

[Workflow](./.cloudflare/ci/workflow.ts) · [Vite+ build caching](../vite-plus-cache)
