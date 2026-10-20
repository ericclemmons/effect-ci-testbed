# Build and serve a static site without a container

Build a small interactive site in a Dynamic Worker and serve its output without
starting a container.

The pipeline reads five commit-pinned files, runs the project's template builder
in an isolated Worker, and publishes HTML, CSS, and JavaScript as an immutable
revision. A separate Worker serves that revision.

## Try the site

[Open the example](https://effect-ci-containerless-site.ericclemmons.workers.dev/r/cf6dd38f2cbb6e89840fb7dc75b6ee681c5eb3c0/index.html)
and click the counter.

For your own deployment, adapt the fixed repository and resource names in
[the Worker](./src/worker.ts) and [configuration](./cloudflare.config.ts), then:

```sh
cd examples/containerless-site
cf deploy
cf workflows instances create effect-ci-containerless-site-build --body '{"instance_id":"my-site-run","params":{"revision":"FULL_40_CHARACTER_COMMIT"}}'
```

The run returns a revision-specific URL. Older URLs retain their original bytes.

This is a bounded JavaScript template build, not npm installation or arbitrary
Vite support. [Static Assets](../static-assets-source) uses Cloudflare's Assets
upload API instead of a Dynamic Worker/DO-backed site.
