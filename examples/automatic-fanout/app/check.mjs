import { readFileSync, writeFileSync } from "node:fs"
import { setTimeout } from "node:timers/promises"

const [name] = process.argv.slice(2)
if (name !== "left" && name !== "right") throw new Error("Expected left or right")
const preparation = JSON.parse(readFileSync("prepared.json", "utf8"))
const started = Date.now()
writeFileSync("branch.txt", name)
await setTimeout(500)
if (readFileSync("branch.txt", "utf8") !== name) throw new Error("Workspace mutation leaked")
const report = { name, started, finished: Date.now(), workspace: process.cwd(), preparation }
writeFileSync("report.json", JSON.stringify(report))
console.log(JSON.stringify(report))
