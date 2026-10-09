import { mkdir, readFile, writeFile } from "node:fs/promises"

const source = await readFile(new URL("../app/message.js", import.meta.url), "utf8")

await mkdir(new URL("../dist", import.meta.url), { recursive: true })
await writeFile(new URL("../dist/message.js", import.meta.url), source)
console.log("Built dist/message.js")
