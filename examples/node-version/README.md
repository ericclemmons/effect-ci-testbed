# Choose a Node.js version

Run CI with the version your project declares.

The snippets on this page come from this example's files, which CI runs end to
end.

## Declare the version

Add a `.node-version` file with an exact version:

[`.node-version`](./.node-version "source")

The capability also reads `.nvmrc` and an exact `package.json#devEngines.runtime`
declaration. `engines.node` describes compatibility, not the selected runtime.

## Define the actions

Create `.cloudflare/ci/actions.ts`. Start with the SDK import:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#L1 "source")

Check out the source first:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=checkout "source")

Install the declared version. `CI.Toolchain.Node` reads the version files from
the checked-out workspace:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=installNode "source 'CI.Toolchain.Node(workspace)'")

Run commands with that version through `node.exec`. This example checks that the
running Node.js matches the declared version:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=verifyNode "source 'node.exec('")

## Define the workflow

Create `.cloudflare/ci/workflow.ts`. The toolchain installs Node.js through Mise,
so the `local` runner uses a container image that includes Mise:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source {10-13}")

## Run it

With Docker running:

```sh
cd examples/node-version
effect-ci run
```

See [Multiple runtimes with Mise](../mise-toolchain) to select more than one
runtime.

## Compare with GitHub Actions

GitHub Actions reads the same file through `actions/setup-node`:

[`.github/workflows/github.yml`](./.github/workflows/github.yml#L11-L19 "source")

## cf ci comparison

[cf ci workflow](./.cloudflare/cf-ci/src/index.ts) downloads the Node.js version
in `.node-version` from nodejs.org in a setup step, saves it as a
`step.runner()` output, and restores it into the version check. The managed
image ships Node.js 24. It does not use Effect CI.

```sh
(cd examples/node-version/.cloudflare/cf-ci && npm ci)
node scripts/cf-ci.mjs node-version
```

See [node-npm](../node-npm/README.md#cf-ci-comparison) for how the script
deploys the pipeline and checks the run.
