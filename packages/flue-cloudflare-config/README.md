# Build Flue agents with modern Cloudflare configuration

Flue 2.2.2 generates real agent Durable Objects, but its public worker-config
customizer uses legacy keys. This small bridge maps that **actual generated
configuration** to the pinned modern Cloudflare Vite plugin. It does not copy a
runtime, invent agent classes or call Wrangler.

```ts
import { cloudflare } from "@cloudflare/vite-plugin";
import { flue, flueWorkerConfig } from "@flue/vite";
import { generatedFlueWorkerConfig } from "@effect-ci-testbed/flue-cloudflare-config";
import { defineConfig } from "vite";

const agents = flue();
const configure = flueWorkerConfig(); // must follow flue() in this evaluation
export default defineConfig({
  plugins: [...agents, cloudflare({ config: generatedFlueWorkerConfig(configure) })],
});
```

Use a **dedicated generated-entrypoint agent host**. This deliberately replaces
its entrypoint with Flue's virtual entry; it must not replace an existing
credential/budget broker's RPC entrypoint. Generated names come from Flue's scan,
retain SQLite class identity, and cannot redirect to other Workers or overwrite
an authored binding/export. Other host configuration is preserved. Keep model
providers and tracing explicit: the repair host must register only its guarded
provider, disable the default gateway and suppress private content telemetry.

The pinned compatibility path is Flue 2.2.2, Vite 8.1.2, Agents 0.20.1 and
Cloudflare Vite `2.0.0-beta.sha-52b0dc0e9`. No claim of arbitrary versions.
Existing deployment histories, namespace renames/deletions and authority still
need operator review; a config translation is not an authorization boundary.

The generator's Babel dependency includes `core-js-pure`. Its postinstall only
prints a funding banner/manages a temporary banner marker; it is explicitly
**disabled** in the workspace policy. The first full-suite head failed with
`ERR_PNPM_IGNORED_BUILDS` until that denial was declared. A fresh tracked-only
archive reproduced the failure; another fresh archive installed and ran the real
generator/workerd test with only that policy change. No new install script was
approved and no release-age exception added.

```sh
pnpm --filter @effect-ci-testbed/flue-cloudflare-config test
pnpm --filter @effect-ci-testbed/flue-cloudflare-config check
```

Verification includes the real generator/build and local workerd/SQLite settled
reply recovery through the shared guarded proposal provider using **fake model
output**. The fixture's constant fake call identity is not a production durable
identity policy. It does not deploy, call Workers AI,
verify a hosted agent, propose a repair or expose a public route. The native
repair inference broker remains a separate private service.
