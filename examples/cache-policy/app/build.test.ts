import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("builds the expected output", async () => {
  const output = await readFile(new URL("./dist/output.txt", import.meta.url), "utf8")
  const input = await readFile(new URL("./src/input.txt", import.meta.url), "utf8")

  assert.equal(output, input.toUpperCase())
})
