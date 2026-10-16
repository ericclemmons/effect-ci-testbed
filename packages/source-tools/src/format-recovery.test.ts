import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareFormatRecovery,
  verifyFormatRecovery,
  runFormatRecovery,
  type FormatRecoveryHost,
} from "./format-recovery.ts";

test("real pinned formatter detects and fixes a formatting failure without AI", async () => {
  const base = { "src/message.ts": 'export const message="Hello"' };
  const plan = await prepareFormatRecovery(base);
  assert.deepEqual(plan.changed, ["src/message.ts"]);
  assert.equal(
    plan.after["src/message.ts"],
    'export const message = "Hello";\n',
  );
  assert.deepEqual(await verifyFormatRecovery(base, plan.after), plan);
  assert.deepEqual((await prepareFormatRecovery(plan.after)).changed, []);
  assert.equal(base["src/message.ts"], 'export const message="Hello"');
});
test("unexpected content, additional/deleted files and no-op proposals reject", async () => {
  const base = { "src/message.ts": 'export const message="Hello"' };
  const { after } = await prepareFormatRecovery(base);
  await assert.rejects(
    verifyFormatRecovery(base, {
      "src/message.ts": 'export const message = "Changed";\n',
    }),
  );
  await assert.rejects(
    verifyFormatRecovery(base, { ...after, "extra.js": "" }),
  );
  await assert.rejects(verifyFormatRecovery(base, { "other.js": "" }));
  await assert.rejects(verifyFormatRecovery(after, after));
});
test("syntax errors abort instead of pretending to autofix", async () => {
  await assert.rejects(
    prepareFormatRecovery({ "src/message.ts": "export const = ;" }),
  );
});
test("no accessor invocation, path escape, symbol or oversized input", async () => {
  let invoked = false;
  const accessor = Object.defineProperty({}, "src/message.ts", {
    get() {
      invoked = true;
      return "";
    },
  });
  await assert.rejects(prepareFormatRecovery(accessor));
  assert.equal(invoked, false);
  for (const input of [
    { "../escape.ts": "" },
    { "/absolute.ts": "" },
    { [Symbol()]: "" },
    { "big.ts": "x".repeat(256 * 1024 + 1) },
  ]) {
    await assert.rejects(prepareFormatRecovery(input));
  }
});

const base = { "src/message.ts": 'export const message="Hello"' };
const commit = "a".repeat(40);
async function harness(overrides: Partial<FormatRecoveryHost> = {}) {
  const calls: string[] = [];
  const { after } = await prepareFormatRecovery(base);
  const host: FormatRecoveryHost = {
    async createCandidate() {
      calls.push("create");
      return commit;
    },
    async readCandidate() {
      calls.push("read");
      return after;
    },
    async verifyCommit(actual) {
      calls.push("verify");
      return { commit: actual, passed: true, evidenceId: "check_123" };
    },
    async assertCurrent() {
      calls.push("drift");
    },
    async propose() {
      calls.push("propose");
      return { url: "https://example.test/pr/1" };
    },
    ...overrides,
  };
  return { calls, host };
}
test("PR creation is last, after exact bytes, exact commit check and drift fence", async () => {
  const { calls, host } = await harness();
  assert.equal((await runFormatRecovery(base, host)).status, "proposed");
  assert.deepEqual(calls, [
    "create",
    "read",
    "verify",
    "read",
    "drift",
    "propose",
  ]);
});
test("unexpected diff, failed/foreign verification or ref drift never create PR", async () => {
  for (const overrides of [
    {
      readCandidate: async () => ({
        "src/message.ts": "export const unexpected = true;\n",
      }),
    },
    {
      verifyCommit: async () => ({
        commit,
        passed: false,
        evidenceId: "check_123",
      }),
    },
    {
      verifyCommit: async () => ({
        commit: "b".repeat(40),
        passed: true,
        evidenceId: "check_123",
      }),
    },
    {
      assertCurrent: async () => {
        throw new Error("base moved");
      },
    },
  ]) {
    const { calls, host } = await harness(overrides);
    await assert.rejects(runFormatRecovery(base, host));
    assert.equal(calls.includes("propose"), false);
  }
});
test("parse failure/no-op makes no candidate; ambiguous mutation is not retried", async () => {
  const { calls, host } = await harness();
  assert.equal(
    (await runFormatRecovery((await prepareFormatRecovery(base)).after, host))
      .status,
    "clean",
  );
  await assert.rejects(runFormatRecovery({ "bad.ts": "const =" }, host));
  assert.deepEqual(calls, []);
  let creates = 0;
  host.createCandidate = async () => {
    creates++;
    throw new Error("lost ACK");
  };
  await assert.rejects(runFormatRecovery(base, host));
  assert.equal(creates, 1);
  assert.deepEqual(calls, []);
});
