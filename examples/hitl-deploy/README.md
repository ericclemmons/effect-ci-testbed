# Approve a deployment in GitHub

Build first, then pause for a human before deploying.

The [deployment action](./.cloudflare/ci/actions.ts) depends on build and requests
`CI.Approval`. The [GitHub job](./.github/workflows/effect-on-github.yml) selects
the `production` environment.

## Set it up

Create `production` in **Settings → Environments** and configure required reviewers.
Run the deployment workflow, then choose **Review deployments → Approve and deploy**.
Rejecting stops deployment.

GitHub must support required environment reviewers for your repository and plan.
The example's deploy command only prints a message.

[Effect workflow](./.cloudflare/ci/workflow.ts) ·
[GitHub Actions comparison](./.github/workflows/github.yml) ·
[Slack approval](../cloudflare-hitl-release)
