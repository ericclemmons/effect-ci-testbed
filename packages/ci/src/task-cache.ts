/** Fixed read-only Node program shared by local Actions and container runners.
 * Keep this as source text: bundlers can add closure references to functions,
 * making Function.toString() unsafe for transporting executable code.
 */
export const taskCacheProgram = String.raw`
const fs = require("node:fs")
const path = require("node:path")
const root = path.resolve(process.argv[1])
const project = path.resolve(root, process.argv[2] || ".")
const relative = path.relative(root, project)
if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
  throw Error("Cache discovery root must be inside the repository")
}
const paths = new Set()
const add = (directory, name) => paths.add(
  path.relative(root, path.join(directory, name)).split(path.sep).join("/"),
)
const inspect = (directory, conventional = false) => {
  const entries = fs.readdirSync(directory, { withFileTypes: true })
  const names = new Set(entries.filter(entry => entry.isFile()).map(entry => entry.name))
  let manifest = {}
  if (names.has("package.json")) {
    try { manifest = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8")) ?? {} }
    catch { /* Invalid project metadata cannot grant cache eligibility. */ }
  }
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies }
  const scripts = Object.values(manifest.scripts ?? {}).filter(value => typeof value === "string").join("\n")
  if (conventional || dependencies["vite-plus"] || /\b(?:vp|vpr)\b/.test(scripts) ||
    [...names].some(name => /^vite\.config\.[cm]?[jt]s$/.test(name))) {
    add(directory, "node_modules/.vite/task-cache")
  }
  if (conventional || dependencies.turbo || /\bturbo\b/.test(scripts) || names.has("turbo.json") || names.has("turbo.jsonc")) {
    add(directory, ".turbo/cache")
  }
  if (conventional || names.has("package.json")) {
    add(directory, ".effect-ci/cache")
    // pnpm otherwise rewrites prunedAt after every fresh install, producing
    // timestamp-only misses in tools that track dependency metadata.
    add(directory, "node_modules/.modules.yaml")
  }
  return entries
}
// Include ancestors: a nested project can use the repository's installation.
for (let directory = project; ; directory = path.dirname(directory)) {
  inspect(directory, directory === project || directory === root)
  if (directory === root) break
}
let visited = 0
const walk = (directory) => {
  if (++visited > 10_000) throw Error("Cache discovery directory limit exceeded")
  for (const entry of inspect(directory)) {
    if (entry.isDirectory() && ![".git", "node_modules", ".effect-ci", ".turbo", ".wrangler", "dist"].includes(entry.name)) {
      walk(path.join(directory, entry.name))
    }
  }
}
walk(project)
console.log(JSON.stringify([...paths].sort()))
`

export function taskCachePaths(repository: string, projectRoot = "."): string[] {
  const { execFileSync } = process.getBuiltinModule("node:child_process") as typeof import("node:child_process")
  return JSON.parse(execFileSync(process.execPath, ["-e", taskCacheProgram, repository, projectRoot], { encoding: "utf8" }))
}
