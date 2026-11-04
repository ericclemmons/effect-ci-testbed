import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { initializeJavaScriptProject } from "./index.ts"

const fixture = (body: (root: string) => void) => {
  const root = mkdtempSync(join(tmpdir(), "ci-bootstrap-"))
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "bootstrap-fixture", version: "0.0.0", scripts: {
      lint: `node -e "require('fs').writeFileSync('checked.txt','ok')"`,
    } }))
    writeFileSync(join(root, "package-lock.json"), JSON.stringify({ name: "bootstrap-fixture", version: "0.0.0",
      lockfileVersion: 3, packages: { "": { name: "bootstrap-fixture", version: "0.0.0" } } }))
    body(root)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("explicit local run creates one empty marker and actually executes the inferred check", () => fixture(root => {
  const bin = fileURLToPath(new URL("./effect-ci.ts", import.meta.url))
  const result = spawnSync(process.execPath, [bin, "run", "lint", "--format=text"], {
    cwd: root, encoding: "utf8", timeout: 30_000,
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(join(root, ".cloudflare/ci/ci.ts"), "utf8"), "")
  assert.equal(readFileSync(join(root, "checked.txt"), "utf8"), "ok")
  assert.equal(initializeJavaScriptProject(["run"], root), undefined)
  const listed = spawnSync(process.execPath, [bin, "list", "--format=json"], { cwd: root, encoding: "utf8" })
  assert.equal(listed.status, 0, listed.stderr)
  assert.deepEqual(JSON.parse(listed.stdout).targets, ["lint"])
}))

test("plan, list, remote and explicit paths never initialize", () => fixture(root => {
  for (const args of [["plan"], ["list"], ["run", "--remote"], ["run", "--workflow", "missing.ts"]]) {
    assert.equal(initializeJavaScriptProject(args, root), undefined)
    assert.equal(existsSync(join(root, ".cloudflare")), false)
  }
}))

test("enrollment keeps discovery local and --local executes working-tree edits", () => fixture(root => {
  mkdirSync(join(root, ".cloudflare/ci"), { recursive: true })
  writeFileSync(join(root, ".cloudflare/ci/oidc.json"), JSON.stringify({
    issuer: "https://unavailable.invalid", repository: "owner/project",
  }))
  const bin = fileURLToPath(new URL("./effect-ci.ts", import.meta.url))
  for (const args of [["list"], ["plan", "lint"], ["run", "lint", "--local"]]) {
    const result = spawnSync(process.execPath, [bin, ...args, "--format=json"], {
      cwd: root, encoding: "utf8", timeout: 30_000,
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.equal(JSON.parse(result.stdout).ok, true)
  }
  assert.equal(readFileSync(join(root, "checked.txt"), "utf8"), "ok")
}))

test("bare CLI and --help describe commands without initializing or executing an unconfigured package", () => fixture(root => {
  const bin = fileURLToPath(new URL("./effect-ci.ts", import.meta.url))
  for (const args of [[], ["--help"]]) {
    const result = spawnSync(process.execPath, [bin, ...args], { cwd: root, encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /effect-ci plan --format=mermaid/)
    assert.match(result.stdout, /effect-ci run lint/)
    assert.equal(existsSync(join(root, ".cloudflare")), false)
    assert.equal(existsSync(join(root, "checked.txt")), false)
  }
}))

test("marker-free package supports list and full Mermaid planning without writing or executing", () => fixture(root => {
  const bin = fileURLToPath(new URL("./effect-ci.ts", import.meta.url))
  const listed = spawnSync(process.execPath, [bin, "list", "--agent"], { cwd: root, encoding: "utf8" })
  assert.equal(listed.status, 0, listed.stderr)
  assert.deepEqual(JSON.parse(listed.stdout).targets, ["lint"])
  const planned = spawnSync(process.execPath, [bin, "plan", "--format=mermaid"], { cwd: root, encoding: "utf8" })
  assert.equal(planned.status, 0, planned.stderr)
  assert.match(planned.stdout, /step_checkout --> step_install/)
  assert.match(planned.stdout, /step_install --> step_lint/)
  assert.equal(existsSync(join(root, ".cloudflare")), false)
  assert.equal(existsSync(join(root, "checked.txt")), false)
}))

test("explicit marker-free directory works for GitHub runners without generating CI config", () => fixture(root => {
  const bin = fileURLToPath(new URL("./effect-ci.ts", import.meta.url))
  const plan = spawnSync(process.execPath, [bin, "--workflow", root, "plan", "--format=mermaid"], {
    cwd: tmpdir(), encoding: "utf8",
  })
  assert.equal(plan.status, 0, plan.stderr)
  assert.match(plan.stdout, /step_install --> step_lint/)
  const run = spawnSync(process.execPath, [bin, "--workflow", root, "run", "lint", "--agent"], {
    cwd: tmpdir(), encoding: "utf8", timeout: 30_000,
  })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(JSON.parse(run.stdout).ok, true)
  assert.equal(readFileSync(join(root, "checked.txt"), "utf8"), "ok")
  assert.equal(existsSync(join(root, ".cloudflare")), false)
}))

test("unknown targets and packages with no actions fail before writing", () => fixture(root => {
  assert.throws(() => initializeJavaScriptProject(["run", "unknown"], root), /Unknown action target/)
  assert.equal(existsSync(join(root, ".cloudflare")), false)
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: {} }))
  assert.throws(() => initializeJavaScriptProject(["run", "start"], root), /no package.json scripts/)
  assert.equal(existsSync(join(root, ".cloudflare")), false)
}))

test("an existing workflow wins and is never overwritten", () => fixture(root => {
  mkdirSync(join(root, ".cloudflare/ci"), { recursive: true })
  writeFileSync(join(root, ".cloudflare/ci/workflow.ts"), "existing workflow")
  assert.equal(initializeJavaScriptProject(["run"], root), undefined)
  assert.equal(existsSync(join(root, ".cloudflare/ci/ci.ts")), false)
  assert.equal(readFileSync(join(root, ".cloudflare/ci/workflow.ts"), "utf8"), "existing workflow")
}))

test("symlinked configuration directories cannot redirect initialization", () => fixture(root => {
  const outside = mkdtempSync(join(tmpdir(), "ci-bootstrap-outside-"))
  try {
    symlinkSync(outside, join(root, ".cloudflare"))
    assert.throws(() => initializeJavaScriptProject(["run", "lint"], root), /ordinary project-owned/)
    assert.equal(existsSync(join(outside, "ci")), false)
  } finally { rmSync(outside, { recursive: true, force: true }) }
}))

test("Vite+ config tasks and arbitrary scripts are actions without executing them during discovery", () => fixture(root => {
  const bin = fileURLToPath(new URL("./effect-ci.ts", import.meta.url))
  mkdirSync(join(root, "node_modules"))
  symlinkSync(fileURLToPath(new URL("../../../examples/vite-plus-cache/app/node_modules/vite-plus", import.meta.url)),
    join(root, "node_modules/vite-plus"), "dir")
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "vite-actions", type: "module",
    devDependencies: { "vite-plus": "1.0.0" }, scripts: { "custom-check": "do-not-run", dev: "do-not-run" } }))
  writeFileSync(join(root, "vite.config.ts"), `
    import { defineConfig, lazyPlugins } from "vite-plus"
    export default defineConfig(() => ({
      plugins: lazyPlugins(() => { throw new Error("discovery must not instantiate plugins") }),
      run: { tasks: {
        build: { command: "tsc -b && vp build" },
        deploy: { command: "wrangler deploy", dependsOn: ["build", "lint"] },
        lint: { command: "vp lint" },
        "release:preview": { command: "do-not-run" }
      } }
    }))
  `)
  const listed = spawnSync(process.execPath, [bin, "list", "--agent"], { cwd: root, encoding: "utf8" })
  assert.equal(listed.status, 0, listed.stderr)
  assert.deepEqual(JSON.parse(listed.stdout).targets, ["build", "custom-check", "deploy", "dev", "lint", "release:preview"])
  assert.ok(!JSON.parse(listed.stdout).commands.includes("effect-ci run"))
  const planned = spawnSync(process.execPath, [bin, "plan", "build", "--agent"], { cwd: root, encoding: "utf8" })
  assert.equal(planned.status, 0, planned.stderr)
  const graph = spawnSync(process.execPath, [bin, "plan", "deploy", "--format=mermaid"], { cwd: root, encoding: "utf8" })
  assert.equal(graph.status, 0, graph.stderr)
  assert.match(graph.stdout, /step_build --> step_deploy/)
  assert.match(graph.stdout, /step_lint --> step_deploy/)
  writeFileSync(join(root, "vite.config.ts"), `export default { run: { tasks: {
    build: { command: "do-not-run", dependsOn: ["custom-check"] },
    lint: "do-not-run",
    deploy: { command: "do-not-run", dependsOn: ["vite-actions#build", "lint"] }
  } } }`)
  const transitive = spawnSync(process.execPath, [bin, "plan", "deploy", "--format=mermaid"], { cwd: root, encoding: "utf8" })
  assert.equal(transitive.status, 0, transitive.stderr)
  assert.match(transitive.stdout, /step_custom_check --> step_build/)
  assert.match(transitive.stdout, /step_build --> step_deploy/)
  assert.match(transitive.stdout, /step_lint --> step_deploy/)
  writeFileSync(join(root, "vite.config.ts"), `export default { run: { tasks: {
    deploy: { command: "do-not-run", dependencies: ["build", "lint"] }
  } } }`)
  const typo = spawnSync(process.execPath, [bin, "plan", "deploy", "--agent"], { cwd: root, encoding: "utf8" })
  assert.equal(typo.status, 2, typo.stderr)
  assert.match(JSON.parse(typo.stdout).error.message, /use dependsOn instead/)
  writeFileSync(join(root, "vite.config.ts"), `export default { run: { tasks: {
    build: { command: "do-not-run", dependsOn: ["deploy"] },
    deploy: { command: "do-not-run", dependsOn: ["build"] }
  } } }`)
  const cycle = spawnSync(process.execPath, [bin, "plan", "deploy", "--agent"], { cwd: root, encoding: "utf8", timeout: 5000 })
  assert.equal(cycle.status, 1, cycle.stderr)
  assert.match(JSON.parse(cycle.stdout).error.message, /Circular Vite\+ task dependency/)
  const unnamed = spawnSync(process.execPath, [bin, "run", "--agent"], { cwd: root, encoding: "utf8" })
  assert.equal(unnamed.status, 2, unnamed.stderr)
  assert.equal(JSON.parse(unnamed.stdout).error.code, "CI_ACTION_REQUIRED")
  assert.equal(existsSync(join(root, ".cloudflare")), false)
  writeFileSync(join(root, "vite.config.ts"), 'export default { tasks: { build: { command: "do-not-run" } } }')
  const invalid = spawnSync(process.execPath, [bin, "list", "--agent"], { cwd: root, encoding: "utf8" })
  assert.equal(invalid.status, 2, invalid.stderr)
  assert.equal(JSON.parse(invalid.stdout).error.code, "CI_VITE_PLUS_CONFIG_INVALID")
  assert.match(JSON.parse(invalid.stdout).error.message, /run.tasks/)
}))
