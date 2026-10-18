import { verifyWebhookSignature } from "../../../packages/github/src/app.ts";
import { boundedBody } from "../../../packages/github/src/webhook-body.ts";

/** Select PR review without changing check-suite execution or Actions runners.
 * Signature/installation/repo are checked before the host can create work. */
export async function smallChangeWebhook(request: Request, secret: string, workflow: Pick<Workflow<{ number: number }>, "create" | "get">) {
  if (request.method !== "POST" || new URL(request.url).pathname !== "/webhooks/github" ||
    !["pull_request", "check_suite"].includes(request.headers.get("x-github-event") ?? "")) return;
  try { return await route(request, secret, workflow); }
  catch { return new Response("PR review webhook unavailable", { status: 503 }); }
}

async function route(request: Request, secret: string, workflow: Pick<Workflow<{ number: number }>, "create" | "get">) {
  const body = await boundedBody(request.clone() as typeof request);
  if (!secret || !await verifyWebhookSignature(secret, body, request.headers.get("x-hub-signature-256")))
    return new Response("Invalid signature", { status: 401 });
  const value = JSON.parse(body), event = request.headers.get("x-github-event");
  if (value.repository?.full_name !== "ericclemmons/effect-ci-testbed" || value.installation?.id !== 165265172) return;
  let numbers: number[];
  if (event === "pull_request") {
    if (!["opened", "reopened", "synchronize", "ready_for_review"].includes(value.action)) return;
    numbers = [value.number];
  } else {
    if (value.action !== "completed" || value.check_suite?.app?.id !== 5089816) return;
    numbers = (value.check_suite?.pull_requests ?? []).map((pr: any) => pr.number);
  }
  const delivery = request.headers.get("x-github-delivery");
  if (!delivery || !/^[a-f0-9-]{36}$/.test(delivery) || numbers.length > 10 ||
    numbers.some(number => !Number.isSafeInteger(number) || number < 1)) return new Response("Invalid review event", { status: 400 });
  for (const number of new Set(numbers)) {
    const id = `review-${delivery}-${number}`;
    try { await (await workflow.get(id)).status(); continue; } catch { /* absent: create once; uncertain ACK never retried here */ }
    await workflow.create({ id, params: { number } });
  }
  return Response.json({ accepted: true, workflow: "small-change", count: numbers.length }, { status: 202 });
}
