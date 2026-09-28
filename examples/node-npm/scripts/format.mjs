import { readFile } from "node:fs/promises"

const files = ["src/index.js", "test/index.test.js"]
const invalid = []

for (const file of files) {
  const contents = await readFile(new URL(`../${file}`, import.meta.url), "utf8")
  if (!contents.endsWith("\n") || contents.split("\n").some((line) => /\s+$/.test(line))) {
    invalid.push(file)
  }
}

if (invalid.length > 0) {
  console.error(`Formatting required: ${invalid.join(", ")}`)
  process.exitCode = 1
} else {
  console.log("Formatting is clean")
}
