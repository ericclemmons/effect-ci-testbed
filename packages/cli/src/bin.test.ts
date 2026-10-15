import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import test from "node:test"

const bin = fileURLToPath(new URL("./bin.ts", import.meta.url))
const repository = fileURLToPath(new URL("../../../", import.meta.url))
const example = fileURLToPath(new URL("../../../examples/exported-actions/", import.meta.url))
const zeroConfig = fileURLToPath(new URL("../../../examples/zero-config/", import.meta.url))

const run = (args: ReadonlyArray<string>, cwd: string = repository) =>
  spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: "utf8",
  })

test("bare cf-ci shows help, Mermaid usage and project targets just like --help", () => {
  const bare = run([], example)
  const explicit = run(["--help"], example)
  assert.equal(bare.status, 0, bare.stderr)
  assert.equal(bare.stdout, explicit.stdout)
  assert.match(bare.stdout, /cf-ci run\s+Execute the whole default workflow/)
  assert.match(bare.stdout, /cf-ci plan --format=mermaid/)
  assert.match(bare.stdout, /Run commands:\n  cf-ci run  \(whole workflow\)\n  cf-ci run check/)
  assert.doesNotMatch(bare.stdout, /CI execution summary/)
})

test("run without a target still executes the default workflow", () => {
  const result = run(["run", "--format=json"], example)
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.ok, true)
  assert.equal(output.workflow, "exported-actions")
  assert.ok(output.plan.nodes.some((node: { id: string }) => node.id === "check"))
})

test("explicit agent mode prints JSON while explicit format takes precedence", () => {
  const agent = run(["run", "--agent"], example)
  assert.equal(agent.status, 0, agent.stderr)
  assert.equal(JSON.parse(agent.stdout).ok, true)
  assert.doesNotMatch(agent.stdout, /CI execution summary/)
  const human = run(["list", "--agent", "--format=text"], example)
  assert.equal(human.status, 0, human.stderr)
  assert.match(human.stdout, /^Workflow: exported-actions/m)
})

test("human defaults to text and direct-agent environment detection defaults to JSON without format flags", () => {
  const humanEnvironment = { PATH: process.env.PATH ?? "" }
  const human = spawnSync(process.execPath, [bin, "list"], {
    cwd: example, encoding: "utf8", env: humanEnvironment,
  })
  assert.equal(human.status, 0, human.stderr)
  assert.match(human.stdout, /^Workflow: exported-actions/m)
  for (const signal of [{ AI_AGENT: "demo" }, { CODEX_THREAD_ID: "local-heuristic-test" }, { CLAUDECODE: "1" }]) {
    const agent = spawnSync(process.execPath, [bin, "list"], {
      cwd: example, encoding: "utf8", env: { ...humanEnvironment, ...signal },
    })
    assert.equal(agent.status, 0, agent.stderr)
    assert.equal(JSON.parse(agent.stdout).workflow, "exported-actions")
    assert.deepEqual(JSON.parse(agent.stdout).commands, ["cf-ci run", "cf-ci run check"])
  }
})

test("discovers workflow.ts and actions.ts from the current project", () => {
  const result = run(["list", "--format=json"], example)

  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout) as {
    readonly targets: ReadonlyArray<string>
    readonly workflow: string
  }
  assert.equal(output.workflow, "exported-actions")
  assert.deepEqual(output.targets, ["check"])
})

test("accepts an explicit workflow path and plans one sibling action", () => {
  const result = run([
    "plan",
    "examples/exported-actions/.cloudflare/ci/workflow.ts",
    "check",
    "--format=json",
  ])

  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout) as {
    readonly target: string
    readonly plan: { readonly nodes: ReadonlyArray<{ readonly id: string }> }
  }
  assert.equal(output.target, "check")
  assert.equal(output.plan.nodes.at(-1)?.id, "check")
})

test("rejects an action that the workflow does not export", () => {
  const result = run(["run", "checkout", "--format=json"], example)

  assert.equal(result.status, 2, result.stderr)
  const output = JSON.parse(result.stdout) as {
    readonly error: {
      readonly code: string
      readonly details: { readonly available: ReadonlyArray<string> }
    }
  }
  assert.equal(output.error.code, "CI_UNKNOWN_TARGET")
  assert.deepEqual(output.error.details.available, ["check"])
})

test("renders the planned action graph as Mermaid", () => {
  const result = run(["plan", "--format=mermaid"], example)

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /^flowchart LR/m)
  assert.match(result.stdout, /step_checkout --> step_check/)
})

test("an empty ci.ts infers conventional package scripts", () => {
  const listed = run(["list", "--format=json"], zeroConfig)

  assert.equal(listed.status, 0, listed.stderr)
  const output = JSON.parse(listed.stdout) as {
    readonly targets: ReadonlyArray<string>
    readonly workflow: string
  }
  assert.equal(output.workflow, "effect-ci-zero-config-fixture")
  assert.deepEqual(output.targets, ["build", "format", "lint", "test"])

  const planned = run(["plan", "--format=mermaid"], zeroConfig)
  assert.equal(planned.status, 0, planned.stderr)
  assert.match(planned.stdout, /step_checkout --> step_install/)
  assert.match(planned.stdout, /step_test --> step_build/)
})
