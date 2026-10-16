import assert from "node:assert/strict"
import test from "node:test"
import { boundedCommandOutput, commandDiagnosticLimit, encodeCommandDiagnostics, decodeCommandDiagnostics, type CommandDiagnostics } from "./command-diagnostics.ts"
const record = (): CommandDiagnostics => ({ version: 1, stepId: "compile", command: "node check.mjs\n# multiline", cwd: "/workspace",
  exitCode: 7, output: { stdout: "compiler context\n", stderr: "missing export\n", truncated: false } })
test("diagnostics preserve both streams through a message-only boundary and bind the exact context", () => {
  const d = record(), message = encodeCommandDiagnostics(d)!
  assert.deepEqual(decodeCommandDiagnostics(new Error(message).message), d)
  assert.deepEqual(decodeCommandDiagnostics(message, { stepId: d.stepId, command: d.command, cwd: d.cwd }), d)
  for (const expected of [{ stepId: "foreign" }, { command: "different" }, { cwd: "/foreign" }])
    assert.equal(decodeCommandDiagnostics(message, expected), undefined)
  assert.equal(decodeCommandDiagnostics("prefix " + message), undefined)
  assert.equal(decodeCommandDiagnostics(message + "garbage"), undefined)
  assert.equal(decodeCommandDiagnostics(message.replace("Command failed (7)", "Command failed (0)")), undefined)
})
test("UTF8 wire bytes and both tails remain bounded, with explicit truncation", () => {
  for (const value of ["x".repeat(100000), "🔥".repeat(50000), "\u0000".repeat(50000)]) {
    const d = { ...record(), output: boundedCommandOutput(value + "stdout-tail", value + "stderr-tail") }
    const message = encodeCommandDiagnostics(d)!
    assert.ok(new TextEncoder().encode(message).length <= commandDiagnosticLimit)
    const decoded = decodeCommandDiagnostics(message)!
    assert.equal(decoded.output.truncated, true)
    assert.ok(decoded.output.stdout.endsWith("stdout-tail")); assert.ok(decoded.output.stderr.endsWith("stderr-tail"))
  }
})
test("unknown, forged, oversized and accessor values are not command diagnostics", () => {
  let accessed = false
  assert.equal(encodeCommandDiagnostics({ ...record(), get output(): never { accessed = true; throw Error("getter") } }), undefined)
  assert.equal(accessed, false)
  for (const d of [{ ...record(), extra: true }, { ...record(), exitCode: 0 },
    { ...record(), output: { ...record().output, secret: "foreign" } },
    { ...record(), command: "x".repeat(16385) }]) assert.equal(encodeCommandDiagnostics(d as any), undefined)
  for (const value of [null, {}, "unknown host error", "x".repeat(32769)]) assert.equal(decodeCommandDiagnostics(value), undefined)
})
