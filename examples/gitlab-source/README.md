# Checkout from GitLab

Run the same source-reading workflow against a GitLab commit.

The Git provider clones a public HTTPS repository at a full commit SHA.
The workflow only uses `CI.Source`; no GitHub-specific action is needed.

## Try it

```sh
cd examples/gitlab-source
effect-ci run
```

Locally, the example reads its included `VERSION` file. The
[Cloudflare wrapper](./src/worker.ts) clones the pinned public
[gitlab-test repository](https://gitlab.com/gitlab-org/gitlab-test) and reads the
same file after restoring checkout.

The wrapper is restricted to that fixture. It does not configure private GitLab
authentication or run GitLab CI. Another repository needs a host-configured
source provider.

[Source providers](../source-providers) · [Configuration](./cloudflare.config.ts)

## cf ci comparison

[cf ci workflow](./.cloudflare/cf-ci/src/index.ts) fetches the pinned public
GitLab fixture over HTTPS at its full commit SHA and checks its `VERSION`. It
needs no GitLab credentials. It does not use Effect CI.

```sh
(cd examples/gitlab-source/.cloudflare/cf-ci && npm ci)
node scripts/cf-ci.mjs gitlab-source
```

See [node-npm](../node-npm/README.md#cf-ci-comparison) for how the script
deploys the pipeline and checks the run.
