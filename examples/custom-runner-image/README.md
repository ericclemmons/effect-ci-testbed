# Customize the CI container

Bake tools into the runner image instead of installing them on every run.

The [Dockerfile](./Dockerfile) adds Python and the Sandbox shim to Debian.
The portable action only needs:

[Source](./.cloudflare/ci/actions.ts#symbol=verifyPython "source")

## Use it on Cloudflare

The [example runner configuration](../../test/apps/example-runner/cloudflare.config.ts)
builds this Dockerfile as its `workspace` image. With Docker and an authorized
Cloudflare account:

```sh
pnpm --filter @effect-ci-testbed/example-runner exec cf deploy
cf workflows instances create effect-ci-example-custom-runner-image --body '{"instance_id":"custom-image-1","params":{"repository":"https://github.com/ericclemmons/effect-ci-testbed.git","revision":"FULL_COMMIT_SHA"}}'
```

Choose your own resource names before deploying into another account.
For tools that can install at runtime, see [system packages](../system-package).
