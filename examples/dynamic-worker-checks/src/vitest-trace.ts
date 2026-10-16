import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
interface Outcome { owner: string; test: number; outcome: string; cpuTime: number; wallTime: number; eventTimestamp: number | null }
const validOwner = (owner: unknown): owner is string => typeof owner === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(owner);
export class AssertionJournal extends DurableObject {
  async record(value: Outcome) {
    if (!validOwner(value.owner) || !Number.isInteger(value.test) || value.test < 0 || value.test >= 16 ||
        !["ok", "exception", "exceededCpu", "exceededMemory", "canceled", "unknown", "scriptNotFound", "responseStreamDisconnected"].includes(value.outcome) ||
        ![value.cpuTime, value.wallTime].every(n => Number.isFinite(n) && n >= 0 && n <= 300000) ||
        (value.eventTimestamp !== null && (!Number.isFinite(value.eventTimestamp) || value.eventTimestamp < 0))) throw Error("Invalid owned tail outcome");
    const data: Outcome = { owner: value.owner, test: value.test, outcome: value.outcome,
      cpuTime: value.cpuTime, wallTime: value.wallTime, eventTimestamp: value.eventTimestamp };
    await this.ctx.storage.transaction(async storage => {
      const owner = await storage.get<string>("owner");
      if (owner !== undefined && owner !== data.owner) throw Error("Owned tail identity mismatch");
      const key = "test:" + data.test, old = await storage.get<Outcome>(key);
      if (old && JSON.stringify(old) !== JSON.stringify(data)) throw Error("Owned tail outcome conflict");
      if (!old) { await storage.put("owner", data.owner); await storage.put(key, data); }
    });
  }
  read(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= 16) throw Error("Invalid owned test index");
    return this.ctx.storage.get<Outcome>("test:" + index);
  }
  override fetch() { return new Response("Not found", { status: 404 }); }
}
export class AssertionTail extends WorkerEntrypoint<{}, { owner: string; test: number }> {
  async tail(events: TraceItem[]) {
    const { owner, test } = this.ctx.props;
    if (!validOwner(owner) || !Number.isInteger(test) || test < 0 || test >= 16 || events.length !== 1) throw Error("Invalid owned tail identity");
    const event = events[0]!;
    const journal = (this.ctx.exports as unknown as { AssertionJournal: DurableObjectNamespace<AssertionJournal> }).AssertionJournal.getByName(owner);
    // Never access or persist logs, exceptions, request data, headers or source.
    await journal.record({ owner, test, outcome: event.outcome,
      cpuTime: event.cpuTime, wallTime: event.wallTime, eventTimestamp: event.eventTimestamp });
  }
  override fetch() { return new Response("Not found", { status: 404 }); }
}
