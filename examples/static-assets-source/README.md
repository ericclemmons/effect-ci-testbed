# Publish static assets without a container

Publish commit-pinned HTML, CSS, and JavaScript through Workers Static Assets.
Optionally compile a small TypeScript entrypoint in an isolated Worker first.

```text
read source → compile when needed → upload assets → deploy → check the site
```

## Try the site

[Open the example](https://effect-ci-static-assets-demo.ericclemmons.workers.dev/)
and click **Verify compiled JavaScript**.

The [workflow](./.cloudflare/ci/workflow.ts) supports `publish` for the three
`site/` files and `build` for the three `build-site/` files. With the private
publisher already configured:

```sh
cf workflows instances create effect-ci-static-assets-publish --body '{"instance_id":"my-static-build-run","params":{"mode":"build","revision":"FULL_40_CHARACTER_COMMIT"}}'
```

The current publisher is scoped to the testbed and its dedicated target.
For your own installation, configure the repository reader, target Worker and
host-held deployment credential; see [setup and authority](./AUTHORITY.md).
The compiler never receives that credential.

Compilation uses pinned Sucrase, not a general Vite/npm toolchain. Source
revisions are immutable. If publication acknowledgement is uncertain, inspect
the existing operation rather than upload again.
