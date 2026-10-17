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
  assert.ok(JSON.stringify({ text: frame.text, blocks: frame.blocks }).length < 6000)
  assert.match(frame.snippetText, /stdout\nx{2400}/)
  assert.ok(frame.compact.text.length < 650)
  const empty = failedCommandOutput({ ...diagnostics, output: { stdout: "", stderr: "", truncated: false } }, [])!
  assert.match(empty.text, /No stdout or stderr was captured/)
  assert.equal(empty.blocks.length, 2)
})

test("snippet excerpts cap lines as well as characters, without dropping retained output", () => {
  const stderr = Array.from({ length: 150 }, (_, index) => `assertion context ${index}`).join("\n")
  const frame = failedCommandOutput({ version: 1, stepId: "test", command: "pnpm test", cwd: "/fixture", exitCode: 1,
    output: { stdout: "", stderr, truncated: false } }, [])!
  assert.ok(frame.compact.text.split("\n").length <= 9)
  assert.match(frame.compact.text, /assertion context 0/)
  assert.doesNotMatch(frame.compact.text, /assertion context 149/)
  assert.match(frame.snippetText, /assertion context 149/)
})
