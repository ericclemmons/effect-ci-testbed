import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"

const input = await readFile(new URL("../src/input.txt", import.meta.url), "utf8")
const key = createHash("sha256").update(input).digest("hex")
const cache = new URL(`../.cache/build/${key}.txt`, import.meta.url)
let output

try {
  output = await readFile(cache, "utf8")
  console.log("custom build cache hit")
} catch {
  output = input.toUpperCase()
  await mkdir(new URL("../.cache/build/", import.meta.url), { recursive: true })
  await writeFile(cache, output)
  console.log("custom build cache miss")
}

await mkdir(new URL("../dist/", import.meta.url), { recursive: true })
await writeFile(new URL("../dist/output.txt", import.meta.url), output)
