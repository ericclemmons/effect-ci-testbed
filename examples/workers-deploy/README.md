# Deploy an app to Cloudflare Workers

Test, build, and deploy one Worker. This is the usual continuous-deployment
pipeline. Other deployment recipes add ordering, triggers, or approvals to it.

```text
install → test ┐
        → build ┴→ deploy
```

The Worker serves a page and a health route. The tests import its `fetch` handler
directly, and `deploy` runs only after both the tests and the build pass.

[Worker](./src/index.ts "source")

[Worker settings](./cloudflare.config.ts "source")

[Actions](./.cloudflare/ci/actions.ts "source")

The actions call the same package scripts that a conventional GitHub Actions job
runs:

[Package scripts](./package.json#json=scripts "source")

[GitHub Actions comparison](./.github/workflows/github.yml "source")

## Run it

```sh
cd examples/workers-deploy
effect-ci run
```

Pull requests, pushes, and manual runs all select `deploy`.

## What the evidence proves

The `deploy` script runs `cf deploy --prebuilt --dry-run`, so CI needs no account
or API token. A passing run shows that the tests pass, `cf build` produces a
Worker bundle, and `cf deploy` accepts that prebuilt bundle and its settings.
It does not show that the Worker was uploaded or that it serves traffic.

To deploy for real, remove `--dry-run` and give the deploy step Cloudflare
credentials. Use [short-lived Wrangler credentials](../oidc-wrangler) or a
`CLOUDFLARE_API_TOKEN` secret. To deploy only from `main`, wrap `deploy` in the
condition from [Deploy only on matching branches or events](../conditional-deploy).

## cf ci comparison

[cf ci workflow](./.cloudflare/cf-ci/src/index.ts) runs `npm ci`, test, build,
and the recipe's dry-run deploy in order. Installed dependencies and the build
output carry over as `step.runner()` outputs. It does not use Effect CI.

```sh
(cd examples/workers-deploy/.cloudflare/cf-ci && npm ci)
node scripts/cf-ci.mjs workers-deploy
```

See [node-npm](../node-npm/README.md#cf-ci-comparison) for how the script
deploys the pipeline and checks the run.
