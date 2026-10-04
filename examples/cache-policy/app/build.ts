import { mkdir, readFile, writeFile } from "node:fs/promises"

const cache = new URL("./.cache/build/output.txt", import.meta.url)
let output: string

try {
  output = await readFile(cache, "utf8")
  console.log("cache hit")
} catch {
  const input = await readFile(new URL("./src/input.txt", import.meta.url), "utf8")

  output = input.toUpperCase()
  await mkdir(new URL("./.cache/build/", import.meta.url), { recursive: true })
  await writeFile(cache, output)
  console.log("cache miss")
}

await mkdir(new URL("./dist/", import.meta.url), { recursive: true })
await writeFile(new URL("./dist/output.txt", import.meta.url), output)
