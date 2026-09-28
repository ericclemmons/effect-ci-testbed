import {
  handleGitHubWebhook,
  type GitHubWebhookEnvironment,
} from "./src/webhook.ts"

export default {
  fetch: (request: Request, environment: GitHubWebhookEnvironment) =>
    handleGitHubWebhook(request, environment),
}
