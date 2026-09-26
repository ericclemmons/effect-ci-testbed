import { cp, mkdir } from "node:fs/promises"

await mkdir("dist", { recursive: true })
await cp("src/index.js", "dist/index.js")

console.log("Built dist/index.js")
