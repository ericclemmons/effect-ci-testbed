# Install system tools

Install an operating-system dependency before your build.

The snippets on this page come from this example's files, which CI runs end to
end.

## Define the actions

Create `.cloudflare/ci/actions.ts`. Start with the SDK import:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#L1 "source")

Check out the source:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=checkout "source")

Install the package with the `CI.PackageManager.Apt` capability. It uses the
current user when root and `sudo` otherwise, so the workflow does not need
runner-specific branches:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=installImageMagick "source {3,5}")

Use the installed tool in the next action:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=verifyImageMagick "source")

## Define the workflow

Create `.cloudflare/ci/workflow.ts`. Its `local` export runs the actions in a
Debian-based Node.js container, so apt is available locally:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source {10-11}")

## Run it

With Docker running:

```sh
cd examples/system-package
effect-ci run
```

The example installs ImageMagick and prints its version.
To skip the install on every run, [bake tools into an image](../custom-runner-image).

## Compare with GitHub Actions

On a GitHub-hosted runner, the same install needs explicit `sudo`:

[`.github/workflows/github.yml`](./.github/workflows/github.yml#L15-L18 "source")
