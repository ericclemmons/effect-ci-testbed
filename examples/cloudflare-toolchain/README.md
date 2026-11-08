# Install Python on Cloudflare

Add Python to a shared runner without maintaining a custom image.

The [prepare action](./.cloudflare/ci/actions.ts) installs Python and pip through
`CI.PackageManager.Apt`, then installs pinned Python build tools. The build
consumes the prepared workspace:

[Source](./.cloudflare/ci/actions.ts#symbol=build "source")

## Run it on Cloudflare

After deploying the [example host](../../test/apps/example-runner):

```sh
cf workflows instances create effect-ci-example-python-toolchain --body '{"instance_id":"python-build-1","params":{"repository":"https://github.com/ericclemmons/effect-ci-testbed.git","revision":"FULL_COMMIT_SHA"}}'
```

The [runner adapter](./src/worker.ts) preserves the prepared workspace between
actions. The result is a wheel and source archive. Local command execution needs
a Debian-based environment with permission to install apt packages.

## cf ci comparison

[cf ci workflow](./.cloudflare/cf-ci/src/index.ts) installs Python with
`apt-get` as root, creates a virtual environment, and builds the package.
`apt-get` installs outside `/workspace`, where no output can save it, so the job
runs in one container. It does not use Effect CI.

```sh
(cd examples/cloudflare-toolchain/.cloudflare/cf-ci && npm ci)
node scripts/cf-ci.mjs cloudflare-toolchain
```

See [node-npm](../node-npm/README.md#cf-ci-comparison) for how the script
deploys the pipeline and checks the run.
