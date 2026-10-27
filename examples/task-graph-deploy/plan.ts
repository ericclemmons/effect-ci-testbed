import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { importTurboGraph } from "./graph.ts"

export function deriveGraph() {
  const root = fileURLToPath(new URL("../../", import.meta.url))
  const require = createRequire(import.meta.url)
  const manifest = require.resolve("turbo/package.json")
  const { version } = JSON.parse(readFileSync(manifest, "utf8")) as { version: string }
  const output = execFileSync(process.execPath, [
    resolve(dirname(manifest), "bin/turbo"),
    "run", "effect-ci-ordered-deploy-frontend#deploy", "--dry=json",
  ], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      TURBO_TELEMETRY_DISABLED: "1",
      TURBO_ROOT_TURBO_JSON: fileURLToPath(new URL("./turbo.json", import.meta.url)),
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  return importTurboGraph(JSON.parse(output), version)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(deriveGraph(), null, 2)}\n`)
}
