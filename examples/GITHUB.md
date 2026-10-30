# GitHub

The [walkthrough](./demo) creates a GitHub repository, enrolls OIDC, opens a PR
with a remote build check, and sends the result to Slack. For an existing project,
choose the integration you need:

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

The walkthrough includes a complete GitHub Actions deployment example using the
authentication action and ordinary `cf deploy`. Enable the operator's deployment
scopes first. From your app, using the source clone path set in the walkthrough:

```sh
mkdir -p .github/workflows
pnpm add --save-dev cf@1.0.0-beta.12 @cloudflare/vite-plugin@2.0.0-beta.v.7
cp "$EFFECT_CI_SOURCE/examples/demo/tutorial/cloudflare.config.ts" cloudflare.config.ts
pnpm exec cf build
cp "$EFFECT_CI_SOURCE/examples/demo/tutorial/oidc.example.yml" .github/workflows/deploy.yml
```

[Deployment workflow](./demo/tutorial/oidc.example.yml "source")

Copying this file does not grant deployment permissions. The action discovers
the committed host from the root checkout, enrolls with GitHub OIDC, and revokes
the temporary token in its post hook, including after deployment failure.
