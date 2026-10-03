import { createHash } from "node:crypto"
import { appendFileSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import type * as CI from "./src/index.ts"

const workflowPath = process.env.EFFECT_CI_WORKFLOW

if (!workflowPath) {
  throw new Error("Missing EFFECT_CI_WORKFLOW")
}

const module = await import(pathToFileURL(resolve(workflowPath)).href) as {
  readonly default?: CI.Workflow<unknown>
}
const workflow = module.default

if (!workflow) {
  throw new Error(`${workflowPath} must default-export a CI workflow`)
}

const cache = workflow.cache
const fingerprint = cache ? createHash("sha256") : undefined

if (cache && fingerprint) {
  for (const path of [...cache.keyFiles].sort()) {
    fingerprint.update(path)
    try {
      fingerprint.update(readFileSync(resolve(path)))
    } catch {
      fingerprint.update("<missing>")
    }
  }
}

const output = {
  enabled: cache !== undefined && cache !== false,
  ...(cache && fingerprint && {
    fingerprint: fingerprint.digest("hex"),
    key: cache.key,
    paths: cache.paths.join("\n"),
  }),
}

if (process.env.GITHUB_OUTPUT) {
  for (const [name, value] of Object.entries(output)) {
    const delimiter = `effect_ci_${name}`
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `${name}<<${delimiter}\n${String(value)}\n${delimiter}\n`,
    )
  }
} else {
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
}
