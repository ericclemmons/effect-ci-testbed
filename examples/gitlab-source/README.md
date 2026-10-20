# Checkout from GitLab

Run the same source-reading workflow against a GitLab commit.

The Git provider clones a public HTTPS repository at a full commit SHA.
The workflow only uses `CI.Source`; no GitHub-specific action is needed.

## Try it

```sh
pnpm exec cf-ci run --workflow examples/gitlab-source/.cloudflare/ci/workflow.ts
```

Locally, the example reads its included `VERSION` file. The
[Cloudflare wrapper](./src/worker.ts) clones the pinned public
[gitlab-test repository](https://gitlab.com/gitlab-org/gitlab-test) and reads the
same file after restoring checkout.

The wrapper is restricted to that fixture. It does not configure private GitLab
authentication or run GitLab CI. Another repository needs a host-configured
source provider.

[Source providers](../source-providers) · [Configuration](./cloudflare.config.ts)
