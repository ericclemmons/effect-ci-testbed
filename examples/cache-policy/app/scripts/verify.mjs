import { readFile } from "node:fs/promises"

const output = await readFile(new URL("../dist/output.txt", import.meta.url), "utf8")

if (output !== "CACHE ME\n") {
  throw new Error(`Unexpected build output: ${JSON.stringify(output)}`)
}
