import { spawnSync } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

const examples = readdirSync("examples", { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join("examples", entry.name, "tsconfig.json"))
  .filter(existsSync)
  .sort()

for (const project of examples) {
  const result = spawnSync("tsc", ["-p", project, "--noEmit"], {
    encoding: "utf8",
    stdio: "inherit",
  })

  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
