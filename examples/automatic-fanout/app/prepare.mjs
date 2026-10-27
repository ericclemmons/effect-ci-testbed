import { randomUUID } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"

const previous = existsSync("prepared.json")
  ? JSON.parse(readFileSync("prepared.json", "utf8")).count
  : 0
const preparation = { count: previous + 1, token: randomUUID() }
writeFileSync("prepared.json", JSON.stringify(preparation))
console.log(JSON.stringify({ event: "prepared", ...preparation }))
