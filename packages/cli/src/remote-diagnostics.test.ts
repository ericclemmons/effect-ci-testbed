import assert from "node:assert/strict"
import test from "node:test"
import { encodeCommandDiagnostics } from "@effect-ci-testbed/ci"
import { remoteCommandDiagnostics, remoteErrorMessage } from "./remote-diagnostics.ts"
const message = (stepId = "compile") => encodeCommandDiagnostics({ version: 1, stepId, command: "node check.mjs", cwd: "/workspace", exitCode: 7,
  output: { stdout: "compiler context\n", stderr: "missing export\n", truncated: false } })!
test("remote diagnostics normalize once without treating an error as retry authority", () => {
  const error = { message: message() }
  const events = [{ error }, { error }, { error: { message: "unknown host failure" } }]
  assert.deepEqual(remoteCommandDiagnostics(events), [{ stepId: "compile", command: "node check.mjs", cwd: "/workspace", exitCode: 7,
    output: { stdout: "compiler context\n", stderr: "missing export\n", truncated: false } }])
  assert.match(remoteErrorMessage(error.message)!, /stdout:\ncompiler context\nstderr:\nmissing export/)
  assert.doesNotMatch(remoteErrorMessage(error.message)!, /effect-ci-command-error-v1/)
  assert.equal(remoteErrorMessage("old workflow failure"), "old workflow failure")
  assert.deepEqual(remoteCommandDiagnostics([{ error: { message: message() + "truncated" } }]), [])
  assert.equal(remoteCommandDiagnostics(Array.from({ length: 30 }, (_, i) => ({ error: { message: message(String(i)) } }))).length, 16)
})
