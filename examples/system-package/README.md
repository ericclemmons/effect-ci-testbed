# Install system tools

Install an operating-system dependency before your build.

[Source](./.cloudflare/ci/actions.ts#symbol=installImageMagick "source")

The capability uses the current user when root and `sudo` otherwise. The workflow
does not need runner-specific branches.

## Run it

With Docker running:

```sh
cd examples/system-package
effect-ci run
```

The example installs ImageMagick and prints its version.
[Actions](./.cloudflare/ci/actions.ts) · [Bake tools into an image](../custom-runner-image)

## cf ci comparison

[cf ci workflow](./.cloudflare/cf-ci/src/index.ts) installs ImageMagick with
`apt-get` in a Cloudflare Workflows `step.runner()` step. Commands run as root,
so no `sudo` is needed. Debian trixie ships ImageMagick 7, whose `convert` still
works. It does not use Effect CI.

```sh
(cd examples/system-package/.cloudflare/cf-ci && npm ci)
node scripts/cf-ci.mjs system-package
```

See [node-npm](../node-npm/README.md#cf-ci-comparison) for how the script
deploys the pipeline and checks the run.
