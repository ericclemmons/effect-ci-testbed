import assert from "node:assert/strict"
import test from "node:test"
import { validateProjectTests, projectTestPolicy } from "./test-protocol.ts"
const input = () => ({ mainModule: "suite.js", modules: { "suite.js": "export function test(e){e(1).toBe(1)}" }, tests: [{ name: "basic", export: "test" }] })
test("bounded test protocol copies data and rejects code/capability/policy overrides before execution", () => {
  const r = input(), copy = validateProjectTests(r)
  r.modules["suite.js"] = "changed"; r.tests[0]!.name = "changed"
  assert.match(copy.modules["suite.js"]!, /export function test/); assert.equal(copy.tests[0]!.name, "basic")
  for (const invalid of [{ ...input(), env: {} }, { ...input(), mainModule: "../suite.js" },
    { ...input(), modules: { "../suite.js": "bad" } }, { ...input(), modules: { "suite.js": "🔥".repeat(projectTestPolicy.maxSourceBytes) } },
    { ...input(), tests: [] }, { ...input(), tests: [{ name: "bad", export: "x;process.exit()" }] },
    { ...input(), tests: [input().tests[0], input().tests[0]] }, { ...input(), tests: Array(17).fill(input().tests[0]) }])
    assert.throws(() => validateProjectTests(invalid))
})
test("project test admission never invokes source/test accessors", () => {
  let accessed = false
  const source = { get "suite.js"(): never { accessed = true; throw Error("getter") } }
  assert.throws(() => validateProjectTests({ ...input(), modules: source }))
  const tests = [input().tests[0]]
  Object.defineProperty(tests, "0", { get() { accessed = true; throw Error("getter") } })
  assert.throws(() => validateProjectTests({ ...input(), tests }))
  assert.equal(accessed, false)
})
