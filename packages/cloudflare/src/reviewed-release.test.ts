import assert from "node:assert/strict";
import test from "node:test";
import type { WorkflowStep } from "cloudflare:workers";
import {
  runReviewedRelease,
  probeRelease,
  type ReleaseCohort,
  type ReviewedObservation,
} from "./reviewed-release.ts";
import {
  ReleaseManager,
  type ReleaseJournal,
  type Deployment,
} from "../../../apps/release-manager/src/release-manager.ts";
import { demoCandidatePolicy } from "./demo-candidate.ts";
const previous = "11111111-1111-4111-8111-111111111111",
  version = "22222222-2222-4222-8222-222222222222";
const candidate = {
  revision: "a".repeat(40),
  digest: "b".repeat(64),
  moduleDigest: "c".repeat(64),
  version,
  script: "effect-ci-hmd-demo",
  policy: demoCandidatePolicy,
} as const;
function harness() {
  let journal: ReleaseJournal | undefined,
    allocation: Deployment = {
      id: "33333333-3333-4333-8333-333333333333",
      versions: [{ version: previous, percentage: 100 }],
    },
    writes = 0,
    commits = 0;
  const manager = new ReleaseManager(
    {
      read: async () => journal,
      write: async (j) => {
        journal = structuredClone(j);
      },
    },
    {
      latest: async () => structuredClone(allocation),
      create: async (versions, message) => {
        writes++;
        allocation = {
          id: `44444444-4444-4444-8444-${String(writes).padStart(12, "0")}`,
          versions: structuredClone(versions),
          message,
        };
        return structuredClone(allocation);
      },
    },
  );
  const names: string[] = [];
  const step = {
    sleep: async (name: string, duration: string) => { names.push(name); assert.equal(duration, "10 seconds"); },
    do: async (name: string, config: any, body: () => Promise<any>) => {
      names.push(name);
      assert.equal(config.retries.limit, 0);
      return body();
    },
  } as unknown as WorkflowStep;
  const broker = {
    prepareCandidate: async () => ({ ...candidate }),
    begin: manager.begin.bind(manager),
    renew: manager.renew.bind(manager),
    promote: manager.promote.bind(manager),
    rollback: manager.rollback.bind(manager),
    complete: async (owner: string) => {
      commits++;
      return manager.complete(owner);
    },
  };
  const probe = async (identity: string): Promise<ReleaseCohort> => {
    const count = identity.endsWith("baseline") ? 0 : Number(identity.split("-").at(-1));
    return {
      requested: 100,
      unknown: 0,
      outcomes: Array.from({ length: 100 }, (_, i) => ({
        version: i < count ? version : previous,
        healthy: true,
      })),
    };
  };
  return { broker, step, probe, names, state: () => ({ journal, allocation, writes, commits }) };
}
test("same verified candidate progresses with four human decisions and commits instead of restoring", async () => {
  const h = harness(),
    reviews: ReviewedObservation[] = [];
  const result = await runReviewedRelease({
    owner: "owned-demo",
    candidate,
    broker: h.broker,
    step: h.step,
    probe: h.probe,
    review: async (o) => {
      reviews.push(o);
      return {
        snapshot: o.snapshot,
        decision: "approved",
        reason: "FAKE local human risk acceptance",
      };
    },
  });
  assert.equal(result.releaseCommitted, true);
  assert.deepEqual(
    reviews.map((o) => o.phase),
    [10, 25, 75, 100],
  );
  assert.equal(
    reviews[0]!.decision.status,
    "uncertain",
    "ten observed requests are not a statistical health pass",
  );
  assert.deepEqual(h.state().allocation.versions, [{ version, percentage: 100 }]);
  assert.equal(h.state().journal?.status, "complete");
  assert.equal(h.state().writes, 4);
  assert.equal(h.state().commits, 1);
  assert.ok(!h.names.includes("vite-release:restore"));
});

test("phase observation waits for a bounded data-plane settling interval, without inventing candidate data", async () => {
  const h = harness();
  let settled = false, waits = 0;
  const promote = h.broker.promote;
  h.broker.promote = async (owner, percentage) => { settled = false; return promote(owner, percentage); };
  h.step.sleep = async (_name, duration) => { assert.equal(duration, "10 seconds"); settled = true; waits++; };
  const result = await runReviewedRelease({
    owner: "settling-demo", candidate, broker: h.broker, step: h.step,
    probe: async (identity, allowed) => identity.endsWith("baseline") || settled
      ? h.probe(identity)
      : { requested: 100, unknown: 0, outcomes: Array.from({ length: 100 }, () => ({ version: previous, healthy: true })) },
    review: async o => ({ snapshot: o.snapshot, decision: "approved", reason: "FAKE test risk acceptance" }),
  });
  assert.equal(result.releaseCommitted, true);
  assert.equal(waits, 4);
});
test("reject, stale decision, missing attribution and regression restore the captured prior allocation", async () => {
  for (const mode of ["reject", "stale", "missing", "zero-candidate", "regression", "timeout"]) {
    const h = harness();
    let reviews = 0;
    await assert.rejects(
      runReviewedRelease({
        owner: "owned-demo",
        candidate,
        broker: h.broker,
        step: h.step,
        probe: async (...args) => {
          const b = await h.probe(args[0]);
          return args[0].endsWith("baseline")
            ? b
            : mode === "missing"
              ? { ...b, unknown: 1 }
              : mode === "zero-candidate"
                ? { ...b, outcomes: b.outcomes.map(o => ({ ...o, version: previous })) }
              : mode === "regression"
                ? {
                    ...b,
                    outcomes: b.outcomes.map((o) => ({ ...o, healthy: o.version === previous })),
                  }
                : b;
        },
        review: async (o) => {
          reviews++;
          if (mode === "timeout") throw Error("Native wait timeout fixture");
          return {
            snapshot: mode === "stale" ? "f".repeat(64) : o.snapshot,
            decision: mode === "reject" ? "rejected" : "approved",
            reason: "FAKE test decision",
          };
        },
      }),
      /prior allocation restored/,
    );
    assert.equal(h.state().journal?.status, "rolled-back", mode);
    assert.deepEqual(h.state().allocation.versions, [{ version: previous, percentage: 100 }]);
    assert.equal(h.state().commits, 0);
    if (mode === "missing" || mode === "zero-candidate" || mode === "regression")
      assert.equal(reviews, 0, "invalid/conclusive health cannot be overridden");
  }
});
test("foreign prepared evidence fails before claim; ambiguous commit never retries or rolls back committed traffic", async () => {
  const foreign = harness();
  foreign.broker.prepareCandidate = async () => ({ ...candidate, moduleDigest: "d".repeat(64) });
  await assert.rejects(
    runReviewedRelease({
      owner: "owned-demo",
      candidate,
      broker: foreign.broker,
      step: foreign.step,
      probe: foreign.probe,
      review: async () => {
        throw Error("No review");
      },
    }),
    /broker evidence/,
  );
  assert.equal(foreign.state().journal, undefined);
  assert.equal(foreign.state().writes, 0);
  const h = harness(),
    complete = h.broker.complete;
  h.broker.complete = async (owner) => {
    await complete(owner);
    throw Error("Lost commit ACK fixture");
  };
  await assert.rejects(
    runReviewedRelease({
      owner: "owned-demo",
      candidate,
      broker: h.broker,
      step: h.step,
      probe: h.probe,
      review: async (o) => ({
        snapshot: o.snapshot,
        decision: "approved",
        reason: "FAKE test decision",
      }),
    }),
    /completion needs reconciliation/,
  );
  assert.equal(h.state().journal?.status, "complete");
  assert.equal(h.state().commits, 1);
  assert.equal(h.state().writes, 4);
  assert.ok(!h.names.includes("vite-release:restore"));
});
test("one closed cohort uses 100 distinct predetermined routing keys, never version overrides", async () => {
  const keys = new Set<string>();
  const result = await probeRelease("owned-10", [previous, version], async (input, init) => {
    const headers = new Headers(init?.headers);
    const key = headers.get("Cloudflare-Workers-Version-Key");
    assert.ok(key, "each synthetic client needs an explicit independent routing identity");
    assert.equal(headers.get("Cloudflare-Workers-Version-Overrides"), null);
    assert.equal(headers.get("authorization"), null);
    assert.ok(!keys.has(key), "never repeat a routing key within the cohort");
    keys.add(key);
    const ordinal = Number(new URL(String(input)).searchParams.get("probe")!.split("-").at(-1));
    assert.equal(key, `effect-ci-cohort:owned-10:${ordinal}`);
    // Models a shared request-level default route. This is a routing contract
    // regression, not proof of Cloudflare's undisclosed internal implementation.
    return Response.json({ version: key && ordinal < 10 ? version : previous, healthy: true });
  });
  assert.equal(keys.size, 100);
  assert.equal(result.unknown, 0);
  assert.equal(result.outcomes.filter(o => o.version === version).length, 10);
});
test("owned health probes reject redirects, oversized bodies, foreign versions and status/health contradictions", async () => {
  for (const response of [
    () => new Response(null, { status: 302, headers: { location: "https://foreign.invalid" } }),
    () => new Response("x".repeat(4097)),
    () => Response.json({ version: "foreign", healthy: true }),
    () => Response.json({ version, healthy: false }),
  ]) {
    let calls = 0;
    const result = await probeRelease("owned", [version], async (input, init) => {
      calls++;
      assert.ok(
        String(input).startsWith("https://effect-ci-hmd-demo.ericclemmons.workers.dev/health?"),
      );
      assert.equal(init?.redirect, "manual");
      assert.equal(new Headers(init?.headers).get("authorization"), null);
      return response();
    });
    assert.equal(calls, 100);
    assert.equal(result.unknown, 100);
    assert.equal(result.outcomes.length, 0);
  }
});
