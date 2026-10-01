import { mkdir, readFile, writeFile } from "node:fs/promises"

const source = await readFile(new URL("../src/index.js", import.meta.url), "utf8")

await mkdir(new URL("../dist", import.meta.url), { recursive: true })
await writeFile(new URL("../dist/index.js", import.meta.url), source)
