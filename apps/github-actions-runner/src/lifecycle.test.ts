import assert from "node:assert/strict";
import test from "node:test";
import { RunnerLifecycle, type Lease, type Ports } from "./lifecycle.ts";
import type { Enrollment } from "./policy.ts";

const policy: Enrollment = { enabled: true, appId: 1, installationId: 2, repositoryId: 3,
  repository: "fixture/private", runnerGroupId: 1, lifetimeSeconds: 900 };
const job = { id: 4, runId: 5, attempt: 1, sha: "a".repeat(40) };
function fixture() {
  let stored: Lease | undefined;
  let now = 0;
  const events: string[] = [];
  let registered = true;
  const github = {
    token: async () => { events.push("token"); return "private-token"; },
    authorize: async () => { events.push("authorize"); return true; },
    jit: async () => { events.push("jit"); return { id: 17, config: "secret-jit-config" }; },
    runner: async () => { events.push("runner"); return registered; },
    remove: async (id: number, name: string) => { assert.equal(id, 17); assert.equal(name, "owned-runner"); events.push("remove"); registered = false; },
    find: async (_name: string, _token: string): Promise<number | undefined> => { events.push("find"); return 17; },
  };
  const ports: Ports = {
    read: async () => structuredClone(stored),
    claim: async (lease) => { if (stored) return false; stored = structuredClone(lease); events.push("claim"); return true; },
    write: async (lease) => { stored = structuredClone(lease); events.push(`write:${lease.phase}`); },
    alarm: async () => { events.push("alarm"); }, now: () => now,
    github: () => github,
    start: async (config) => { assert.equal(config, "secret-jit-config"); events.push("start"); },
    destroy: async () => { events.push("destroy"); },
  };
  return { ports, github, events, lease: () => stored, expire: () => { now = 900001; }, finish: () => { registered = false; } };
}

test("journal precedes one JIT mint and one start; duplicate calls and process reload do not relaunch", async () => {
  const f = fixture();
  await Promise.all(Array.from({ length: 10 }, () => new RunnerLifecycle(f.ports).launch(job, policy, "owned-runner")));
  assert.equal(f.events.filter((v) => v === "jit").length, 1);
  assert.equal(f.events.filter((v) => v === "start").length, 1);
  assert.ok(f.events.indexOf("write:minting") < f.events.indexOf("jit"));
  assert.ok(f.events.indexOf("write:starting") < f.events.indexOf("start"));
  assert.equal(await new RunnerLifecycle(f.ports).reconcile(), "running");
  assert.doesNotMatch(JSON.stringify(f.lease()), /private-token|secret-jit-config/);
  f.finish();
  assert.equal(await new RunnerLifecycle(f.ports).reconcile(), "done");
  assert.ok(f.events.indexOf("destroy") < f.events.indexOf("remove"));
  await new RunnerLifecycle(f.ports).launch(job, policy, "owned-runner");
  assert.equal(f.events.filter((v) => v === "jit").length, 1);
});

test("canceled, changed, public or otherwise ineligible authoritative jobs never mint", async () => {
  const f = fixture(); f.github.authorize = async () => false;
  await new RunnerLifecycle(f.ports).launch(job, policy, "owned-runner");
  assert.equal(f.lease()?.phase, "done");
  assert.ok(!f.events.includes("jit") && !f.events.includes("start"));
});

test("lost JIT ACK holds capacity and reconciles the SAME registration by exact name", async () => {
  const f = fixture();
  f.github.jit = async () => { f.events.push("jit"); throw Error("secret upstream body"); };
  await new RunnerLifecycle(f.ports).launch(job, policy, "owned-runner");
  assert.equal(f.lease()?.phase, "quarantined");
  assert.doesNotMatch(JSON.stringify(f.lease()), /secret upstream/);
  f.github.find = async () => undefined;
  assert.equal(await new RunnerLifecycle(f.ports).reconcile(), "quarantined");
  f.github.find = async () => 17;
  assert.equal(await new RunnerLifecycle(f.ports).reconcile(), "done");
  assert.ok(!f.events.includes("start"));
  assert.equal(f.events.filter((v) => v === "jit").length, 1);
});

test("start ACK loss is not permission to start twice; cleanup failure retains lease", async () => {
  const f = fixture();
  f.ports.start = async () => { f.events.push("start"); throw Error("start ACK lost"); };
  await new RunnerLifecycle(f.ports).launch(job, policy, "owned-runner");
  f.ports.destroy = async () => { f.events.push("destroy"); throw Error("cleanup unavailable"); };
  assert.equal(await new RunnerLifecycle(f.ports).reconcile(), "cleaning");
  assert.ok(!f.events.includes("remove"));
  await new RunnerLifecycle(f.ports).launch(job, policy, "owned-runner");
  assert.equal(f.events.filter((v) => v === "start").length, 1);
  f.ports.destroy = async () => { f.events.push("destroy"); };
  assert.equal(await new RunnerLifecycle(f.ports).reconcile(), "done");
});

test("expiry stops compute BEFORE GitHub authentication, including during an outage", async () => {
  const f = fixture();
  await new RunnerLifecycle(f.ports).launch(job, policy, "owned-runner");
  f.expire(); f.events.length = 0;
  f.github.token = async () => { f.events.push("token"); throw Error("GitHub down"); };
  assert.equal(await new RunnerLifecycle(f.ports).reconcile(), "running");
  assert.deepEqual(f.events, ["alarm", "destroy", "token"]);
  assert.notEqual(f.lease()?.phase, "done", "registration cleanup still required; pool cannot release capacity");
});

for (const phase of ["authorizing", "minting", "starting"] as const) {
  test(`restart at ${phase} cannot remint/restart; independent deadline cleanup remains armed`, async () => {
    const f = fixture();
    await f.ports.claim({ policy, job, name: "owned-runner", phase, deadline: 900000,
      ...(phase === "starting" ? { runnerId: 17 } : {}) });
    assert.equal(await new RunnerLifecycle(f.ports).reconcile(), phase);
    assert.deepEqual(f.events, ["claim", "alarm"]);
    f.expire();
    assert.equal(await new RunnerLifecycle(f.ports).reconcile(), "done");
    assert.ok(!f.events.includes("jit") && !f.events.includes("start"));
  });
}
