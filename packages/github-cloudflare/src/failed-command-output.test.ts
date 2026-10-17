import assert from "node:assert/strict"
import test from "node:test"
import { failedCommandOutput } from "./failed-command-output.ts"

test("failure streams preserve literal lines and indentation without markdown or mention elements", () => {
  const stdout = 'Expected: "hello"\nReceived: "goodbye"\n  at test.ts:6\n```\n<https://example.invalid|not a link>\n<!channel>'
  const frame = failedCommandOutput({ version: 1, stepId: "test", command: "pnpm test", cwd: "/fixture", exitCode: 1,
    output: { stdout, stderr: "assertion failed\n  source line", truncated: false } }, [])!
  const expected = ["pnpm test · exit 1", "stdout\n" + stdout.replace("<!channel>", "[mention suppressed]"), "stderr\nassertion failed\n  source line"]
  assert.deepEqual(frame.blocks, expected.map(text => ({ type: "rich_text", elements: [
    { type: "rich_text_preformatted", elements: [{ type: "text", text }] },
  ] })))
  assert.equal(frame.text, expected.join("\n"))
})

test("preformatted output retains redaction, bounds, truncation and empty-stream fallback", () => {
  const diagnostics = { version: 1 as const, stepId: "test", command: "pnpm test", cwd: "/fixture", exitCode: 1,
    output: { stdout: "x".repeat(2400) + "\nBearer private-token\nowned-secret", stderr: "", truncated: false } }
  const frame = failedCommandOutput(diagnostics, ["owned-secret"])!
  assert.doesNotMatch(JSON.stringify(frame), /owned-secret|private-token/)
  assert.match(frame.text, /stdout \(tail; output truncated\)/)
  assert.ok(JSON.stringify(frame).length < 6000)
  const empty = failedCommandOutput({ ...diagnostics, output: { stdout: "", stderr: "", truncated: false } }, [])!
  assert.match(empty.text, /No stdout or stderr was captured/)
  assert.equal(empty.blocks.length, 2)
})
