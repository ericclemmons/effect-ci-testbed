import { readFileSync } from "node:fs"

const manifest = JSON.parse(readFileSync("package.json", "utf8"))
if (!manifest.name.startsWith("@turbo-ci/")) throw Error("Unexpected package name")
console.log(`Checked ${manifest.name}`)
