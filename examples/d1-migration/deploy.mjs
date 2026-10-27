import { spawnSync } from "node:child_process"

if (process.env.EFFECT_CI_D1_FAIL_DEPLOY === "1") {
  throw new Error("Injected deployment failure after migration; keep the expanded database and retry without EFFECT_CI_D1_FAIL_DEPLOY")
}

const result = spawnSync("./node_modules/.bin/cf", [
  "deploy", "--prebuilt", "--mode", "production", "--dry-run",
], { stdio: "inherit" })

if (result.error) throw result.error
process.exitCode = result.status ?? 1
