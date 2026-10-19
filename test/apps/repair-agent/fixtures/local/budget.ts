import { WorkerEntrypoint, DurableObject } from "cloudflare:workers";
import { flueBudgetInput } from "@effect-ci-testbed/flue-budget-provider/policy";
export class FakeBudget extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS calls (id TEXT PRIMARY KEY, run TEXT)");
  }
  status() {
    const reservations = this.ctx.storage.sql.exec("SELECT id, run FROM calls").toArray();
    return {
      budget: "friday-demo-repair-2-usd-v1",
      reservedCents: reservations.length * 10,
      remainingCents: 700 - reservations.length * 10,
      reservations,
    };
  }
  runStream(run: string, id: string, model: string, input: unknown) {
    flueBudgetInput(model, input, { returnRawResponse: true });
    if (
      model !== "@cf/meta/llama-3.3-70b-instruct-fp8-fast" ||
      run !== "friday-flue-proposal-v1" ||
      !/^flue_[a-f0-9]{64}$/.test(id)
    )
      throw new Error("Fake budget context rejected");
    this.ctx.storage.sql.exec("INSERT INTO calls VALUES (?, ?)", id, run);
    const body =
      'data: {"choices":[{"delta":{"content":"export function healthStatus() { return 200; }"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\ndata: [DONE]\n\n';
    return {
      reservationId: id,
      reservedCents: 10,
      body,
      byteLength: new TextEncoder().encode(body).length,
      contentType: "text/event-stream",
    };
  }
}
export default class FakeService extends WorkerEntrypoint {
  private budget() {
    return (
      this.ctx.exports as unknown as { FakeBudget: DurableObjectNamespace<FakeBudget> }
    ).FakeBudget.getByName("owned");
  }
  status() {
    return this.budget().status();
  }
  runStream(run: string, id: string, model: string, input: unknown) {
    return this.budget().runStream(run, id, model, input);
  }
}
