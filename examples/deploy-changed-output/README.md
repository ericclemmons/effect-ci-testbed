# Deploy only changed build output

A shared package changed, but the app did not. Should it deploy?
Compare the rebuilt output, not just the app's source files.

[Source](./.cloudflare/ci/workflow.ts#symbol=default "source")

## Try it

```sh
cd examples/deploy-changed-output
effect-ci run
effect-ci run
```

The first run publishes; the second skips deployment. Edit
[packages/greeting/message.mjs](./packages/greeting/message.mjs) and run again.
The importing app's HTML changes, so it publishes once more.

This example copies `dist` to a local directory. The
[directory adapter](../../packages/ci/src/directory-deployment.md) compares paths,
bytes, executable bits, and destination configuration. Failed builds or
publication do not advance the last-successful baseline.

[Workflow](./.cloudflare/ci/workflow.ts) · [Vite+ build caching](../vite-plus-cache)
