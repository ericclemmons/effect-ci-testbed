import { access, mkdir, readFile, writeFile } from "node:fs/promises"

const service = process.argv[2]
const orderPath = ".effect-ci-state/deployment-order"

if (service !== "backend" && service !== "frontend") {
  throw new Error(`Unknown service: ${service}`)
}

await access(`dist/${service}/worker.js`)
await mkdir(".effect-ci-state", { recursive: true })

let deployed = []
try {
  deployed = (await readFile(orderPath, "utf8")).trim().split("\n").filter(Boolean)
} catch (error) {
  if (error.code !== "ENOENT") throw error
}

const expected = service === "backend" ? [] : ["backend"]
if (deployed.join(",") !== expected.join(",")) {
  throw new Error(`Cannot deploy ${service} after [${deployed.join(", ")}]`)
}

deployed.push(service)
await writeFile(orderPath, `${deployed.join("\n")}\n`)
console.log(`npx wrangler deploy --config ${service}/wrangler.jsonc`)
