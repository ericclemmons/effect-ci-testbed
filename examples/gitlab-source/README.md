# Checkout from GitLab

Run the same source-reading workflow against a GitLab commit.

The Git provider clones a public HTTPS repository at a full commit SHA.
The workflow only uses `CI.Source`; no GitHub-specific action is needed.

The snippets on this page come from this example's files, which CI runs end to
end.

## Define the workflow

Create `.cloudflare/ci/workflow.ts`. It checks out the source, confirms that a
Git checkout is at the exact full commit SHA it asked for, and reads `VERSION`:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source {12-16}")

Nothing here names GitLab. The host's source provider decides where checkout
comes from.

## Try it

```sh
cd examples/gitlab-source
effect-ci run
```

Locally, the example reads its included `VERSION` file.

## Run it on Cloudflare against GitLab

The Cloudflare wrapper clones the pinned public
[gitlab-test repository](https://gitlab.com/gitlab-org/gitlab-test) and reads the
same file after restoring checkout. Pin the repository and full commit SHA:

[`src/reference.ts`](./src/reference.ts#L1-L2 "source")

The Worker's Workflow rejects any other source, then gives the runner that
repository and revision. Effect CI runs the workflow through the runner's source
and executors:

[`src/worker.ts`](./src/worker.ts "source {13-14}")

The Worker imports [`.cloudflare/ci/standalone.ts`](./.cloudflare/ci/standalone.ts),
the same verification written as one action that returns the workspace. It has
no HTTP route; only native Workflow dispatch starts a run.

Configure the Worker, its workspace container, and the Workflow:

[`cloudflare.config.ts`](./cloudflare.config.ts "source")

The wrapper is restricted to that fixture. It does not configure private GitLab
authentication or run GitLab CI. Another repository needs a host-configured
source provider. See [Source providers](../source-providers).
