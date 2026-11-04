import assert from "node:assert/strict"
import { execFileSync, spawn, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import * as CI from "@effect-ci-testbed/ci"

test("remote human output matches the executed local build without native bookkeeping", async () => {
  const root = mkdtempSync(join(tmpdir(), "effect-ci-human-"))
  const server = createServer()
  const bin = fileURLToPath(new URL("effect-ci.ts", import.meta.url))
  const hosted = fileURLToPath(new URL("hosted.ts", import.meta.url))
  const sdk = fileURLToPath(new URL("../../ci/src/index.ts", import.meta.url))
  try {
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    mkdirSync(join(root, ".cloudflare/ci"), { recursive: true })
    writeFileSync(join(root, ".cloudflare/ci/workflow.ts"), `
      import * as CI from ${JSON.stringify(sdk)};
      export const build = CI.action("build", () => function* () {
        const source = yield* CI.Source;
        return yield* (yield* source.checkout()).exec('node -e "console.log(\\\'build output\\\')"');
      });
      export default CI.workflow("demo", () => build());
    `)
    for (const args of [["init", "-q"], ["config", "user.name", "Fixture"],
      ["config", "user.email", "fixture@example.invalid"], ["add", "."], ["commit", "-qm", "fixture"],
      ["remote", "add", "origin", "https://github.com/example/demo.git"]]) {
      execFileSync("git", args, { cwd: root })
    }
    const local = (format: string) => spawnSync(process.execPath,
      [hosted, "run", "build", "--local", `--format=${format}`],
      { cwd: root, encoding: "utf8", env: { PATH: process.env.PATH }, timeout: 20_000 })
    const human = local("text")
    assert.equal(human.status, 0, human.stdout + human.stderr)
    assert.match(human.stdout, /build output/)
    const agent = local("json")
    assert.equal(agent.status, 0, agent.stdout + agent.stderr)
    let commandOutput = human.stdout
    const bookkeeping = ["workflow_queued", "workflow_started", "workflow_running", "attempt_started", "attempt_completed"]
      .map(type => ({ type }))
    const events = () => [
      ...bookkeeping,
      ...["workspace-cache:restore-1", 'file:["install",1,"read"]-1', 'command:["install",1]-1']
        .flatMap(stepName => [{ type: "step_started", stepName }, { type: "step_completed", stepName }]),
      { type: "step_completed", stepName: 'command:["project workflow",1]-1', output: JSON.stringify({ stdout: commandOutput, stderr: "" }) },
      { type: "workflow_completed" },
    ].map((event, index) => ({ ...event, eventId: index + 1 }))
    server.on("request", (request, response) => {
      if (request.url === "/capabilities") {
        response.end(JSON.stringify({ protocol: "effect-ci-remote-v1", targets: ["build"] }))
      } else if (request.url === "/runs") {
        response.writeHead(202)
        response.end(JSON.stringify({ instanceId: "human-fixture", eventsUrl: "/runs/human-fixture/events", statusUrl: "/runs/human-fixture" }))
      } else {
        response.writeHead(200, { "content-type": "application/x-ndjson" })
        response.end(events().map(event => JSON.stringify(event)).join("\n") + "\n")
      }
    })
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    assert.ok(address && typeof address !== "string")
    const remote = (format = "text") => new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [bin, "run", "build", "--remote", `--format=${format}`], {
        cwd: root, env: { PATH: process.env.PATH, EFFECT_CI_REMOTE_URL: `http://127.0.0.1:${address.port}`, EFFECT_CI_REMOTE_TOKEN: "fixture" },
      })
      let stdout = "", stderr = ""
      child.stdout.on("data", chunk => { stdout += chunk })
      child.stderr.on("data", chunk => { stderr += chunk })
      child.on("error", reject)
      child.on("close", code => resolve({ code, stdout, stderr }))
    })
    const result = await remote()
    assert.equal(result.code, 0, result.stdout + result.stderr)
    assert.equal(result.stdout.replace("Remote Workflow human-fixture\n", "").replace("✓ Workflow completed\n", ""), human.stdout)
    assert.doesNotMatch(result.stdout, /workflow_queued|attempt_started|workspace-cache:|file:\[|command:\[/)
    commandOutput = agent.stdout
    const legacy = await remote()
    assert.equal(legacy.code, 0, legacy.stdout + legacy.stderr)
    assert.ok(legacy.stdout.includes(CI.formatPlan(JSON.parse(agent.stdout).plan)))
    assert.doesNotMatch(legacy.stdout, /"schemaVersion"/)
    const json = await remote("json")
    assert.equal(json.code, 0, json.stdout + json.stderr)
    assert.deepEqual(JSON.parse(json.stdout).result.events, events())
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(root, { recursive: true, force: true })
  }
})
