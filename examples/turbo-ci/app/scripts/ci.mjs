import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const turbo = fileURLToPath(new URL("../node_modules/turbo/bin/turbo", import.meta.url))
const execute = (args) => {
  const result = spawnSync(process.execPath, [turbo, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, TURBO_TELEMETRY_DISABLED: "1" },
    maxBuffer: 16 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    process.stderr.write(result.stderr)
    process.stdout.write(result.stdout)
    process.exit(result.status ?? 1)
  }
  return result.stdout
}

const query = JSON.parse(execute(["query", `query {
  packages {
    items {
      tasks(filter: {and: [
        {has: {field: TAG, value: "ci"}},
        {not: {has: {field: TAG, value: "!ci"}}}
      ]}) { items { fullName } }
    }
  }
}`]))
if (query.errors?.length || !Array.isArray(query.data?.packages?.items)) {
  throw Error("Turbo CI task discovery failed")
}
const targets = query.data.packages.items.flatMap(({ tasks }) =>
  tasks.items.map(({ fullName }) => fullName)).sort()
if (!targets.length) throw Error("No Turbo tasks tagged ci were selected")

const args = ["run", ...targets, "--cache=local:rw"]
if (process.argv.includes("--plan")) {
  process.stdout.write(execute([...args, "--dry=json"]))
} else {
  console.log("Turbo CI entrypoints:", targets.join(", "))
  process.stdout.write(execute(args))
}
