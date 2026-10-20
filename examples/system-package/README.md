# Install system tools

Install an operating-system dependency before your build.

```ts
const apt = yield* CI.PackageManager.Apt(workspace)
return yield* apt.install(["imagemagick"])
```

The capability uses the current user when root and `sudo` otherwise. The workflow
does not need runner-specific branches.

## Run it

With Docker running:

```sh
pnpm exec cf-ci run --workflow examples/system-package/.cloudflare/ci/workflow.ts
```

The example installs ImageMagick and prints its version.
[Actions](./.cloudflare/ci/actions.ts) · [Bake tools into an image](../custom-runner-image)
