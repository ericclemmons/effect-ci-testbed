# GitHub

Choose the part you want. GitHub is optional for the local walkthrough.

| Problem | Use |
| --- | --- |
| Keep GitHub Actions; run the same authored workflow | [npm](./node-npm) or [pnpm](./node-pnpm), with comparison YAML beside the workflow. |
| Move execution to an enrolled Effect CI host | [GitHub CI on Cloudflare](./github-cloudflare-ci). The App receives events and reports checks. |
| Keep deployment tools; remove a stored Cloudflare token | [cf OIDC](./oidc-cf) or [Wrangler OIDC](./oidc-wrangler). |
| Approve a safe diff | [Safe-change approval](./small-change). |

## Run the same checks remotely

After an operator installs the GitHub App and enrolls your repository on a host:

```sh
effect-ci oidc --service https://your-ci-host
effect-ci doctor --remote
effect-ci run test build --remote
```

Enrollment writes public repository/service metadata, not credentials. Local users
need an authorized Access session. GitHub Actions uses `id-token: write` and the
public host URL; no stored Effect CI token is required.

The host must advertise the requested goals. Runs use a pushed commit, not
uncommitted local edits. Adding `--remote` does not install the App or configure
its program. [Host setup](../apps/effect-ci/SELF-HOST.md).

## Deployment credentials only

The walkthrough app includes an optional GitHub Actions deployment example.
Bootstrap the Worker and complete [issuer enrollment](../apps/github-actions-runner/OIDC.md)
first. Then install the workflow in the copied app:

```sh
mkdir -p .github/workflows
cp tutorial/oidc.example.yml .github/workflows/deploy.yml
```

[Deployment workflow](./demo/tutorial/oidc.example.yml "source")

The unpublished CLI must be installed in the job; copying this file does not
install it or grant permissions. The OIDC wrapper revokes the child command's
token on exit and preserves a deployment failure's exit code.
