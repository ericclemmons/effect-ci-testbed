import assert from "node:assert/strict";
import test from "node:test";
import * as CI from "@effect-ci-testbed/ci";
import { signExecutionReceipt, verifyExecutionReceipt, type ExecutionIdentity } from "./execution-receipt.ts";
import * as Execution from "./execution-receipt.ts";

const identity: ExecutionIdentity = {
  issuer: "https://ci.acme.example", repository: "https://git.acme.example/team/project.git",
  revision: "a".repeat(40), workflowId: "arbitrary-workflow", policyDigest: "b".repeat(64),
  runtimeDigest: "c".repeat(64), inputsDigest: "d".repeat(64), eventDigest: "e".repeat(64),
};
const keyPair = () => crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
const execute = async (fail = false, value: unknown = { private: "PRIVATE_RESULT" }) => {
  let attempt: CI.WorkflowAttempt | undefined;
  const check = CI.check("arbitrary-check", () => function* () {});
  const action = CI.action<unknown>("arbitrary-action", () => function* () { if (fail) throw Error("PRIVATE_FAILURE"); return value; });
  await CI.runPromise(CI.workflow(identity.workflowId, function* () { yield* check(); return yield* action(); }), {
    output: "silent", onAttempt: actual => { attempt = actual; },
  }).catch(() => undefined);
  assert.ok(attempt);
  return attempt;
};

test("host prepares portable observation commitments before crossing the private signing RPC", async () => {
  const keys = await keyPair();
  const attempt = await execute(false, CI.Workspace.remote("private-owner", "/workspace/repository", {
    provider: "cloudflare-container", value: { id: "PRIVATE_SNAPSHOT_CAPABILITY", size: 10 },
  }));
  const claim = await Execution.prepareExecutionClaim({ identity, instanceId: "native-observation", attempt });
  const portable = JSON.parse(JSON.stringify(claim));
  assert.ok(!JSON.stringify(portable).includes("PRIVATE_SNAPSHOT_CAPABILITY"));
  assert.equal(portable.steps.find((step: any) => step.id === "arbitrary-action").output.kind, "workspace");
  const receipt = await Execution.signExecutionClaim({ keyId: "acme", key: keys.privateKey, claim: portable });
  const verified = await verifyExecutionReceipt(JSON.stringify(receipt), identity, new Map([["acme", keys.publicKey]]));
  assert.deepEqual(verified, claim);
  assert.deepEqual((await signExecutionReceipt({ keyId: "acme", key: keys.privateKey, identity,
    instanceId: "native-observation", attempt })).claim, claim);
});

test("receipts sign arbitrary actual checks/actions and workflow outcomes without exposing outputs", async () => {
  const keys = await keyPair();
  for (const fail of [false, true]) {
    const attempt = await execute(fail);
    const receipt = await signExecutionReceipt({ keyId: "acme", key: keys.privateKey, identity, instanceId: "native-1", attempt });
    const serialized = JSON.stringify(receipt);
    assert.doesNotMatch(serialized, /PRIVATE_RESULT|PRIVATE_FAILURE/);
    const verified = await verifyExecutionReceipt(serialized, identity, new Map([["acme", keys.publicKey]]));
    assert.ok(verified);
    assert.equal(verified.conclusion, fail ? "failure" : "success");
    assert.deepEqual(verified.steps.find(s => s.id === "arbitrary-check")?.output, { kind: "void" });
    const action = verified.steps.find(s => s.id === "arbitrary-action")!;
    assert.equal(action.status, attempt.plan.nodes.find(s => s.id === "arbitrary-action")!.status);
    if (fail) assert.notEqual(action.status, "complete");
    else assert.equal(action.status, "complete");
    assert.equal(action.output?.kind, fail ? undefined : "json");
    assert.equal(verified.instanceId, "native-1");
    assert.equal(verified.attempt, 1);
  }
});

test("snapshot/artifact outputs are commitments, unavailable values never invent portable artifacts", async () => {
  const keys = await keyPair();
  const workspace = CI.Workspace.remote("owner", "/workspace/repository", {
    provider: "cloudflare-container", value: { id: "PRIVATE_SNAPSHOT_CAPABILITY", size: 12 },
  });
  const checkpoint = new CI.WorkspaceCheckpoint("build", workspace, workspace.revision!);
  const artifact = new CI.WorkspaceArtifact("video", ["proof.mp4"], checkpoint);
  let getters = 0;
  const accessor = Object.defineProperty({}, "secret", { enumerable: true, get() { getters++; return "PRIVATE"; } });
  const cyclic: any = {}; cyclic.self = cyclic;
  for (const [value, kind] of [[workspace, "workspace"], [checkpoint, "checkpoint"], [artifact, "artifact"],
    [accessor, "uncommitted"], [cyclic, "uncommitted"], [new Date(), "uncommitted"], [() => {}, "uncommitted"],
    [Array(200).fill("😀".repeat(1000)), "uncommitted"], [{ ["x".repeat(65_537)]: 1 }, "uncommitted"],
    [{ nested: undefined }, "uncommitted"], [NaN, "uncommitted"], [-0, "uncommitted"]] as const) {
    const base = await execute();
    // Host test supplies a retained provider output, not a public caller claim.
    const attempt = { ...base, outputs: { ...base.outputs, "arbitrary-action": value } };
    const receipt = await signExecutionReceipt({ keyId: "acme", key: keys.privateKey, identity, instanceId: "native-1", attempt });
    const output = receipt.claim.steps.find(s => s.id === "arbitrary-action")?.output;
    assert.equal(output?.kind, kind);
    assert.equal(Boolean(output?.digest), kind !== "uncommitted");
    assert.doesNotMatch(JSON.stringify(receipt), /PRIVATE_SNAPSHOT_CAPABILITY|proof\.mp4/);
  }
  assert.equal(getters, 0);
});

test("only pinned issuer, exact identities and enrolled keys verify; tampering/domain confusion fails", async () => {
  const keys = await keyPair(), other = await keyPair(), attempt = await execute();
  const receipt = await signExecutionReceipt({ keyId: "acme", key: keys.privateKey, identity, instanceId: "native-1", attempt });
  const serialized = JSON.stringify(receipt), trust = new Map([["acme", keys.publicKey]]);
  for (const field of Object.keys(identity) as Array<keyof ExecutionIdentity>) {
    const changed = { ...identity, [field]: field === "issuer" ? "https://other.example" : field === "repository" ? "https://git.example/other" :
      field === "workflowId" ? "different" : field === "revision" ? "f".repeat(40) : "f".repeat(64) };
    assert.equal(await verifyExecutionReceipt(serialized, changed, trust), undefined, field);
  }
  assert.equal(await verifyExecutionReceipt(serialized, identity, new Map()), undefined);
  assert.equal(await verifyExecutionReceipt(serialized, identity, new Map([["acme", other.publicKey]])), undefined);
  for (const mutate of [
    (r: any) => { r.claim.conclusion = "failure"; },
    (r: any) => { r.claim.steps[0].status = "failed"; },
    (r: any) => { r.claim.instanceId = "another-run"; },
    (r: any) => { r.claim.steps[1].output.digest = "f".repeat(64); },
    (r: any) => { r.purpose = "step-result"; },
    (r: any) => { r.publicKey = "self-enrolled"; },
  ]) {
    const modified = JSON.parse(serialized); mutate(modified);
    assert.equal(await verifyExecutionReceipt(JSON.stringify(modified), identity, trust), undefined);
  }
  for (const invalid of [undefined, "{", "x".repeat(131_073), "null"]) assert.equal(await verifyExecutionReceipt(invalid, identity, trust), undefined);
  await assert.rejects(signExecutionReceipt({ keyId: "acme", key: keys.privateKey, identity: { ...identity, workflowId: "wrong" }, instanceId: "native-1", attempt }));
  await assert.rejects(signExecutionReceipt({ keyId: "acme", key: keys.privateKey, identity, instanceId: "native-1", attempt: { ...attempt, plan: { ...attempt.plan, mode: "plan" } } }));
});

test("signing snapshots before awaiting and preserves observed reuse without inventing fresh execution", async () => {
  const keys = await keyPair(), base = await execute();
  const mutableIdentity = { ...identity }, data = { result: "original" };
  const attempt = { ...base, outputs: { ...base.outputs, "arbitrary-action": data },
    plan: { ...base.plan, nodes: base.plan.nodes.map(node => node.id === "arbitrary-action" ? { ...node, status: "reused" as const } : node) } };
  const pending = signExecutionReceipt({ keyId: "acme", key: keys.privateKey, identity: mutableIdentity, instanceId: "native-1", attempt });
  mutableIdentity.inputsDigest = "f".repeat(64); data.result = "changed";
  const receipt = await pending;
  assert.equal(receipt.claim.identity.inputsDigest, identity.inputsDigest);
  assert.equal(receipt.claim.steps.find(s => s.id === "arbitrary-action")!.status, "reused");
  const original = await signExecutionReceipt({ keyId: "acme", key: keys.privateKey, identity, instanceId: "native-1",
    attempt: { ...attempt, outputs: { ...attempt.outputs, "arbitrary-action": { result: "original" } } } });
  assert.equal(receipt.claim.steps.find(s => s.id === "arbitrary-action")!.output?.digest,
    original.claim.steps.find(s => s.id === "arbitrary-action")!.output?.digest);
  assert.ok(await verifyExecutionReceipt(JSON.stringify(receipt), identity, new Map([["acme", keys.publicKey]])));
});
