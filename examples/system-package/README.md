# Install a system package

This example answers one question:

> How do I install an operating-system dependency before running my project?

The action asks for the workspace-bound Apt capability and installs ImageMagick:

```ts
const apt = yield* CI.PackageManager.Apt(workspace)

return yield* apt.install(["imagemagick"])
```

The capability uses the current user directly when it is root and `sudo` otherwise.
Package names are validated before becoming part of a shell command. This makes the
action portable between a local root container and a GitHub runner without embedding
environment checks in the workflow.

Compare:

- [plain GitHub Actions using `apt-get`](./.github/workflows/github.yml)
- [Effect CI on GitHub](./.github/workflows/effect-on-github.yml)
- [the portable actions](./.cloudflare/ci/actions.ts)
- [the workflow and local runner](./.cloudflare/ci/workflow.ts)

With Docker running:

```sh
./examples/system-package/.cloudflare/ci/workflow.ts
```

The example uses ImageMagick because it is a familiar build dependency that is not
part of the selected slim Node container. Other Debian packages use the same capability.
