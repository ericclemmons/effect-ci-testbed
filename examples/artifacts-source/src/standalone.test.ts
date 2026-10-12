import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("the example owns its binding, native dispatch and container image", () => {
  const config = read("cloudflare.config.ts")
  assert.match(config, /ARTIFACTS: bindings\.artifacts\(\{ namespace: "default" \}\)/)
  assert.match(config, /entrypoint: "\.\/src\/worker\.ts"/)
  assert.match(config, /name: "effect-ci-artifacts-source-checks"/)
  assert.match(config, /dockerfile: "\.\/Dockerfile"/)
  assert.match(read("Dockerfile"), /sandbox-shim/)
  assert.match(read("src/worker.ts"), /this\.env\.ARTIFACTS\.get\(event\.payload\.repository\)/)
  assert.match(read("src/worker.ts"), /import workflow from "\.\.\/\.cloudflare\/ci\/workflow\.ts"/)
})

test("no example implementation or configuration imports another example or app", () => {
  for (const path of ["cloudflare.config.ts", "vite.config.ts", "tsconfig.json", "Dockerfile", "src/worker.ts",
    ".cloudflare/ci/workflow.ts", ".cloudflare/ci/actions.ts"]) {
    assert.doesNotMatch(read(path), /(?:\.\.\/){2,}.*(?:apps|examples)\//, path)
    assert.doesNotMatch(read(path), /apps\/example-runner|custom-runner-image/, path)
  }
  assert.ok(!Object.hasOwn(JSON.parse(read("tsconfig.json")), "extends"))
})

test("deployment instructions start in the example and do not dispatch the shared host", () => {
  const readme = read("README.md")
  assert.match(readme, /cd examples\/artifacts-source/)
  assert.match(readme, /cf deploy/)
  assert.match(readme, /instances create effect-ci-artifacts-source-checks/)
})
