import assert from "node:assert/strict";
import test from "node:test";
import { assertRoutingDiagnosticPayload, runRoutingDiagnostic, routingDiagnosticCandidate } from "./demo-routing-diagnostic.ts";

test("diagnostic input cannot choose source, version, target or invoke accessors", () => {
  assertRoutingDiagnosticPayload({ mode: "observe-fixed-candidate" });
  let invoked = false;
  for (const value of [null, {}, { mode: "observe-fixed-candidate", version: "foreign" }, { get mode() { invoked = true; return "observe-fixed-candidate"; } }, { mode: "observe-fixed-candidate", [Symbol()]: 1 }])
    assert.throws(() => assertRoutingDiagnosticPayload(value));
  assert.equal(invoked, false);
});

test("fixed 0/30/120-second comparison uses the same prepared candidate, never approves/commits, and always restores", async () => {
  for (const failure of [false, true]) {
    const baseline = "f8526596-f9b8-4068-87c0-c517844488a8", names: string[] = [], waits: string[] = [];
    let phase = 0, calls = 0, restores = 0;
    const view = () => ({ candidate: routingDiagnosticCandidate.version, status: "active", previous: [{ version: baseline, percentage: 100 }], deployment: { id: "11111111-1111-4111-8111-111111111111", versions: phase ? [{ version: baseline, percentage: 90 }, { version: routingDiagnosticCandidate.version, percentage: 10 }] : [{ version: baseline, percentage: 100 }] } });
    const broker: any = {
      prepareCandidate: async (revision: string, digest: string) => { assert.equal(revision, routingDiagnosticCandidate.revision); assert.equal(digest, routingDiagnosticCandidate.digest); return routingDiagnosticCandidate; },
      begin: async () => view(), renew: async () => view(),
      promote: async (_owner: string, p: number) => { assert.equal(p, 10); phase = p; return view(); },
      rollback: async () => { restores++; phase = 0; return { ...view(), status: "rolled-back" }; },
      complete: async () => { throw Error("diagnostic must not commit"); },
    };
    const step: any = { do: async (name: string, config: any, body: any) => { names.push(name); assert.equal(config.retries.limit, 0); if (failure && name === "routing:probe-keyed-30") throw Error("FAKE persisted probe failure"); return body(); }, sleep: async (_name: string, duration: string) => { waits.push(duration); } };
    const operation = runRoutingDiagnostic("owned-diagnostic", step, broker, async (_input, init) => {
      calls++; const key = new Headers(init?.headers).get("Cloudflare-Workers-Version-Key");
      return Response.json({ version: phase && key && calls % 10 === 0 ? routingDiagnosticCandidate.version : baseline, healthy: true });
    });
    if (failure) await assert.rejects(operation, /persisted probe failure/);
    else {
      const result = await operation;
      assert.equal(result.diagnosticComplete, true);
      assert.equal(result.uploadPerformed, false);
      assert.equal(result.releaseCommitted, false);
      assert.deepEqual(result.observations.map(o => o.scheduledSeconds), [0, 30, 120]);
      assert.equal(calls, 700);
      assert.deepEqual(waits, ["30 seconds", "90 seconds"]);
    }
    assert.equal(restores, 1);
    assert.equal(phase, 0);
    assert.ok(!names.some(n => /approve|commit/.test(n)));
  }
});
