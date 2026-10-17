import { verifyWebhookSignature } from "../../../packages/github/src/app.ts";
import { boundedBody } from "../../../packages/github/src/webhook-body.ts";

export type RunnerWebhookEnvironment = {
  GITHUB_WEBHOOK_SECRET?: string;
  GITHUB_ACTIONS_RUNNER?: Pick<Fetcher, "fetch">;
};

/** One App/webhook URL; only workflow_job leaves the ordinary CI router. */
export async function runnerWebhook(request: Request, env: RunnerWebhookEnvironment): Promise<Response | undefined> {
  if (request.method !== "POST" || new URL(request.url).pathname !== "/webhooks/github" ||
      request.headers.get("x-github-event") !== "workflow_job") return;
  if (!env.GITHUB_WEBHOOK_SECRET) return new Response("Webhook not configured", { status: 503 });
  try {
    const body = await boundedBody(request);
    const signature = request.headers.get("x-hub-signature-256");
    if (!await verifyWebhookSignature(env.GITHUB_WEBHOOK_SECRET, body, signature))
      return new Response("Invalid signature", { status: 401 });
    if (!env.GITHUB_ACTIONS_RUNNER) return Response.json({ accepted: false, reason: "runner disabled" }, { status: 202 });
    // Service binding is host-owned. Never forward Access/browser/API credentials
    // or allow the payload to choose a destination. The runner verifies HMAC again.
    return await env.GITHUB_ACTIONS_RUNNER.fetch("https://runner.internal/github/webhook", {
      method: "POST", body, redirect: "manual",
      headers: { "content-type": "application/json", "x-github-event": "workflow_job", "x-hub-signature-256": signature! },
    });
  } catch {
    return new Response("Runner webhook unavailable", { status: 503 });
  }
}
