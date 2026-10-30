import { mkdirSync, readFileSync, writeFileSync } from "node:fs"

const manifest = JSON.parse(readFileSync("package.json", "utf8"))
const message = manifest.name === "@turbo-ci/core"
  ? readFileSync("message.txt", "utf8").trim()
  : JSON.parse(readFileSync("../core/dist/message.json", "utf8")).message
mkdirSync("dist", { recursive: true })
writeFileSync("dist/message.json", JSON.stringify({ package: manifest.name, message }))
console.log(`Built ${manifest.name}: ${message}`)
