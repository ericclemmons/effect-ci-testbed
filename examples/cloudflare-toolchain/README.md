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
