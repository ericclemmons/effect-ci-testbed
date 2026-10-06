import { spawnSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const examples = readdirSync("examples", { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

const failures: Array<string> = []

for (const example of examples) {
  const root = join("examples", example)
  const workflow = join(root, ".cloudflare", "ci", "workflow.ts")
  const readme = join(root, "README.md")

  try {
    readFileSync(workflow)
  } catch {
    continue
  }

  const markdown = readFileSync(readme, "utf8")
  const documented = markdown.match(/```mermaid\n([\s\S]*?)\n```/)?.[1]
  if (!documented) {
    failures.push(`${example}: README has no Mermaid plan`)
    continue
  }

  const result = spawnSync(
    process.execPath,
    ["packages/cli/src/bin.ts", "--workflow", workflow, "plan", "--format=mermaid"],
    { encoding: "utf8" },
  )

  if (result.status !== 0) {
    failures.push(`${example}: plan failed\n${result.stderr.trim()}`)
    continue
  }

  if (documented !== result.stdout.trim()) {
    failures.push(`${example}: README plan differs from generated plan`)
  }
}

if (failures.length > 0) {
  throw new Error(`Example plan documentation is stale:\n${failures.join("\n")}`)
}
