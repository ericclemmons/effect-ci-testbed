# Customize the Cloudflare runner image

> How do I bake operating-system tools into the CI image instead of installing them on every run?

```mermaid
flowchart LR
  step_checkout["checkout"]
  step_verify_baked_in_python["verify baked-in python"]
  step_checkout --> step_verify_baked_in_python
```

---

The project-owned [Dockerfile](./Dockerfile) starts from Debian Trixie, installs Python,
and copies Cloudflare Sandbox 1.0's `sandbox-shim` into the image. Wrangler builds that
file as the `workspace` image used by `WorkspaceContainer`.

The portable action only declares the capability it expects:

```ts
yield* workspace.exec("python3 --version")
```

Compare this with [installing a system package at runtime](../system-package) and
[preparing Python at runtime](../cloudflare-toolchain). A custom image has a larger
build and rollout boundary, but every workspace starts with the tool already present.
Runtime installation keeps the shared image generic and becomes part of the
checkpointed action graph.

Run `pnpm dev` in this directory with Docker available, then trigger
`pnpm trigger -- --local` to exercise the actual custom image through `wrangler dev`.
