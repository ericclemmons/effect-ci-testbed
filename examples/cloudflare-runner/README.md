# Run Effect CI on Cloudflare

This example answers one question:

> How do I execute `checkout → install → build` in a Cloudflare Workflow and Sandbox instead of on a GitHub runner?

The action and workflow files use the same portable Effect CI API as the local and
GitHub examples. The Worker is intentionally userland-only:

```ts
import * as Cloudflare from "@effect-ci-testbed/cloudflare"

import workflow from "../.cloudflare/workflows/build.ts"

export { Sandbox } from "@effect-ci-testbed/cloudflare"

export default {
  fetch() {
    return new Response("Effect CI Cloudflare runner")
  },
}

export const EffectCIWorkflow = Cloudflare.workflowEntrypoint(workflow)
```

`@effect-ci-testbed/cloudflare` owns the host mechanics. It creates the native
`WorkflowEntrypoint`, derives the repository and revision from the Workflow payload,
binds each run to a Sandbox, and supplies `CI.Source` and `CI.CommandExecutor` to the
portable runtime:

- `CI.Source` clones the requested Git repository into a Cloudflare Sandbox.
- `CI.Workspace.exec()` executes commands in that Sandbox.
- Native Cloudflare Workflow steps checkpoint `checkout`, `install`, and `build`.

The example still exports `Sandbox` because Wrangler must discover the Durable Object
class named by `wrangler.jsonc`. Everything specific to this repository remains in its
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

You can inspect the resulting instance with Wrangler's local Workflow commands.

## Deliberate first-slice limits

This proves the runner boundary, not complete remote-CI durability. A Sandbox ID is
stable, but its filesystem is ephemeral if the container is replaced. Restoring a
workspace from R2, GitHub status reporting, human approval, healing, and distributed
fan-out belong in later examples. Each action here contains exactly one durable remote
operation so the Effect graph and Cloudflare Workflow history remain easy to compare.

The Sandbox SDK package and Docker image are both pinned to `0.12.10`; those versions
must stay aligned.
