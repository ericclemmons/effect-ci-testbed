import { access, readFile } from "node:fs/promises"

await access("dist/worker.js")
const version = (await readFile(".effect-ci-state/schema-version", "utf8")).trim()

console.log(`npx wrangler rollback # schema remains at ${version}`)
