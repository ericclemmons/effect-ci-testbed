import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const ci = fileURLToPath(new URL("../../ci/src/index.ts", import.meta.url))
const bin = fileURLToPath(new URL("./bin.ts", import.meta.url))

function fixture(fail = false) {
  const root = mkdtempSync(join(tmpdir(), "effect-ci-nested-events-"))
  writeFileSync(join(root, "child.mjs"), `import * as CI from ${JSON.stringify(ci)};
    const action=CI.action('inner',()=>function*(){
      console.log('nested-event-fd='+String(process.env.EFFECT_CI_EVENT_FD));
      ${fail ? "throw Error('actual nested failure');" : ""}
    });
    await CI.runPromise(CI.workflow('nested',()=>action()),{output:'silent'});`)
  writeFileSync(join(root, "workflow.ts"), `import * as CI from ${JSON.stringify(ci)};
    const checkout=CI.action('checkout',function*(){const source=yield*CI.Source;return()=>source.checkout()});
    const command=CI.action('command',function*(){const w=yield*checkout();return()=>w.exec('node child.mjs')});
    export default CI.workflow('outer',()=>command());`)
  return root
}

for (const fail of [false, true]) test(`nested SDK execution isolates the parent's event pipe (failure=${fail})`, () => {
  const root = fixture(fail)
  const result = spawnSync(process.execPath, [bin, "run", "--workflow", join(root, "workflow.ts"), "--format=text"], {
    cwd: root, encoding: "utf8", timeout: 15_000,
    env: { ...process.env, EFFECT_CI_EVENT_FD: "3" },
    stdio: ["ignore", "pipe", "pipe", "pipe"],
  })
  assert.equal(result.status, fail ? 1 : 0, result.stderr)
  assert.match(result.stdout, /nested-event-fd=undefined/)
  assert.doesNotMatch(result.stderr, /invalid argument, write|bad file descriptor/)
  const events = String(result.output[3]).trim().split("\n").map(line => JSON.parse(line))
  assert.ok(events.length > 0)
  assert.ok(events.every(event => event.workflowId === "outer"))
  assert.ok(events.some(event => event.type === "step.status" && event.stepId === "command" &&
    event.status === (fail ? "failed" : "complete")))
  if (fail) assert.match(result.stderr, /actual nested failure/)
})

test("an actually broken parent event pipe still fails closed", () => {
  const root = fixture()
  const result = spawnSync(process.execPath, [bin, "run", "--workflow", join(root, "workflow.ts"), "--format=text"], {
    cwd: root, encoding: "utf8", timeout: 15_000,
    env: { ...process.env, EFFECT_CI_EVENT_FD: "99999" },
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /write|descriptor/)
})
