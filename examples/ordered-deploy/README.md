# Deploy apps in dependency order

Deploy the backend before the frontend that needs it.

```text
build applications → deploy backend → deploy frontend
```

Each deployment depends on the shared build. The aggregate deploy action calls
the two deployments in order; the build runs once.

## Run it

```sh
pnpm exec effect-ci run --workflow examples/ordered-deploy/.cloudflare/ci/workflow.ts
```

The two Workers build with `cf build` and deploy with
`cf deploy --prebuilt --dry-run`. No credentials or live deployment are needed.

[Actions](./.cloudflare/ci/actions.ts) ·
[GitHub Actions comparison](./.github/workflows/github.yml)
