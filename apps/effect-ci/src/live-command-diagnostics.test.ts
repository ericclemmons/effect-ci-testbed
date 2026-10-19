import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { commandDiagnosticLimit, decodeCommandDiagnostics } from "../../../packages/ci/src/command-diagnostics.ts";
import { remoteErrorMessage } from "../../../packages/cli/src/remote-diagnostics.ts";

test("retained real native lint failure preserves same-attempt stdout/stderr for remote agents", {
  skip: process.env.LIVE_NATIVE_COMMAND_DIAGNOSTICS !== "1",
}, () => {
  const cf = (...args: string[]) => JSON.parse(execFileSync(process.env.CF_BIN ?? "cf", args, {
    encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024,
  }));
  const id = "edbdb213-1ce2-44d2-84ab-40688db4dcb1", workflow = "effect-ci-demo";
  const h = cf("workflows", "instances", "get", id, "--workflow-name", workflow);
  assert.equal(h.status, "errored");
  assert.equal(h.params.revision, "4005974fd8fb85765008428e21a75e6792cc3fca");
  assert.equal(h.params.trigger, "remote");
  assert.ok(["https://github.com/ericclemmons/effect-ci-testbed", "https://github.com/ericclemmons/effect-ci-testbed.git"].includes(h.params.repository));
  const name = 'command:["lint",1]-1';
  const failed = h.steps.find((s: any) => s.name === name);
  assert.ok(failed); assert.equal(failed.success, false); assert.equal(failed.attempts.length, 1);
  assert.equal(failed.config.retries.limit, 0); assert.equal(failed.attempts[0].success, false);
  assert.ok(!h.steps.some((s: any) => /publish site|prepare release|host-finalize:custom:review/.test(s.name)));
  const envelope = cf("workflows", "instances", "step", "get", id, "--workflow-name", workflow,
    "--name", name, "--type", "step", "--attempt", "1");
  const full = envelope.result ?? envelope;
  assert.equal(full.status, "errored");
  const d = decodeCommandDiagnostics(full.error?.message);
  assert.ok(d); assert.ok(Buffer.byteLength(full.error.message) <= commandDiagnosticLimit);
  assert.equal(d.stepId, "lint"); assert.equal(d.command, 'npm run "lint"'); assert.equal(d.exitCode, 1);
  assert.equal(d.cwd, "/workspace/repository/test/fixtures/demo"); assert.equal(d.output.truncated, false);
  assert.match(d.output.stdout, /eslint\(no-undef\)/); assert.match(d.output.stdout, /'process' is not defined/);
  assert.match(d.output.stdout, /'console' is not defined/); assert.match(d.output.stderr, /npm notice/);
  assert.match(remoteErrorMessage(full.error.message)!, /stdout:/);
  assert.doesNotMatch(remoteErrorMessage(full.error.message)!, /effect-ci-command-error-v1/);
  // Optional operator-local actual CLI receipt; compare it to independent full
  // native checkpoint output, never treat this unsigned local file as authority.
  if (process.env.LIVE_NATIVE_COMMAND_CLI_RECEIPT) {
    const r = JSON.parse(readFileSync(process.env.LIVE_NATIVE_COMMAND_CLI_RECEIPT, "utf8"));
    assert.equal(r.acceptance, false); // Preserve the unmet original exit7 intent.
    assert.equal(r.instance, id); assert.equal(r.status, 1); assert.equal(r.errorCode, "CI_WORKFLOW_FAILED");
    assert.deepEqual(r.cli.error.details.diagnostics, [{ stepId: d.stepId, command: d.command, cwd: d.cwd,
      exitCode: d.exitCode, output: d.output }]);
  }
  // Expected exit7 script never ran: this original run remains ERRORED for its
  // earlier genuine lint failure. No re-dispatch, reset, HTTP error or AI call.
});
