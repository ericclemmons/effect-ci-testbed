import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { setTimeout } from "node:timers/promises"

const manifest = JSON.parse(readFileSync("package.json", "utf8"))
const startedAt = Date.now()
if (manifest.name !== "@turbo-ci/core") {
  writeFileSync("../../branch.txt", manifest.name)
  await setTimeout(800)
  if (readFileSync("../../branch.txt", "utf8") !== manifest.name) throw Error("Sibling workspaces are not isolated")
}
const message = manifest.name === "@turbo-ci/core"
  ? readFileSync("message.txt", "utf8").trim()
  : JSON.parse(readFileSync("../core/dist/message.json", "utf8")).message
mkdirSync("dist", { recursive: true })
writeFileSync("dist/message.json", JSON.stringify({ package: manifest.name, message, startedAt, finishedAt: Date.now() }))
console.log(`Built ${manifest.name}: ${message}`)
