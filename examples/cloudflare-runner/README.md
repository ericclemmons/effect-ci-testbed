# Run Effect CI on Cloudflare

This example answers one question:

> How do I checkpoint and restore `checkout → install → build` in a Cloudflare Workflow and Container?

The action and workflow files use the same portable Effect CI API as the local and
GitHub examples. The Worker is intentionally userland-only:

```ts
import * as Cloudflare from "@effect-ci-testbed/cloudflare"

import workflow from "../.cloudflare/workflows/build.ts"

export { WorkspaceContainer } from "@effect-ci-testbed/cloudflare"

export default {
  fetch() {
    return new Response("Effect CI Cloudflare runner")
  },
}

export const EffectCIWorkflow = Cloudflare.workflowEntrypoint(workflow)
```

`@effect-ci-testbed/cloudflare` uses the Durable Object Container API directly. There
is no Sandbox SDK dependency or custom image in this example. Each run gets a
`WorkspaceContainer` Durable Object backed by Cloudflare's managed
`cloudflare/debian-trixie` image, which includes Node.js 24.

- `CI.Source` clones the requested Git repository into the Container.
- `CI.Workspace.exec()` uses the native `ctx.container.exec()` API.
- `install` creates a native filesystem snapshot with `workspace.checkpoint()`.
- `build` destroys the original Container, restores that checkpoint, and builds from
  the restored filesystem.

The example exports `WorkspaceContainer` because Wrangler must discover the Durable
Object class named by `wrangler.jsonc`. Everything repository-specific remains in its
workflow and actions.

Start a local Worker with Docker running:

```sh
pnpm dev
```

Then trigger the native Workflow from another terminal:

```sh
pnpm exec wrangler workflows trigger effect-ci-cloudflare-runner \
  '{"repository":"https://github.com/ericclemmons/effect-ci-testbed.git","revision":"main"}' \
  --local
```

This local run intentionally exercises the production-shaped path: Workflow → Durable
Object → managed Container → snapshot → destroy → restore → build. It requires Docker
and Wrangler 4.145 or newer. You can inspect the resulting instance with Wrangler's
local Workflow commands.

## Deliberate first-slice limits

This proves native workspace durability, not artifact publication. Container snapshots
are immutable, tied to their image version, and currently have an implicit 30-day TTL.
Portable build artifacts still need a separate artifact store. Restoring one install
snapshot into several Workspace Durable Objects for lint/test/build fan-out is the next
slice.
