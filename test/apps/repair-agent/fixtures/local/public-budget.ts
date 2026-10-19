import { WorkerEntrypoint } from "cloudflare:workers";
import { FakeBudget } from "./budget.ts";
import { PUBLIC_REQUIRED_RESERVATIONS } from "@effect-ci-testbed/github/public-proposal";
/** LOCAL FAKE ONLY: seed synthetic prior reservations, never a reset method or
 * a production budget implementation. The real broker/ledger is unchanged.
 */
export class FakePublicBudget extends FakeBudget {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS invalid_status (flag INTEGER PRIMARY KEY)");
    for (const [id, run] of PUBLIC_REQUIRED_RESERVATIONS)
      ctx.storage.sql.exec("INSERT OR IGNORE INTO calls VALUES (?, ?)", id, run);
  }
  invalidateBudget() { this.ctx.storage.sql.exec("INSERT OR IGNORE INTO invalid_status VALUES (1)"); }
  override status() {
    const value = super.status();
    return this.ctx.storage.sql.exec("SELECT flag FROM invalid_status").toArray().length
      ? { ...value, budget: "LOCAL-invalid-ledger" } : value;
  }
}
export default class extends WorkerEntrypoint {
  private budget() {
    return (this.ctx.exports as unknown as { FakePublicBudget: DurableObjectNamespace<FakePublicBudget> }).FakePublicBudget.getByName("local-public");
  }
  status() { return this.budget().status(); }
  invalidateBudget() { return this.budget().invalidateBudget(); }
  runStream(...args: Parameters<FakeBudget["runStream"]>) { return this.budget().runStream(...args); }
}
