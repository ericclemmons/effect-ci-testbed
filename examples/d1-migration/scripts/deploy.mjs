import { access, readFile } from "node:fs/promises"

await access("dist/worker.js")
const version = (await readFile(".effect-ci-state/schema-version", "utf8")).trim()

if (version !== "0001_create_users") {
  throw new Error(`Expected migration 0001_create_users, received ${version}`)
}

console.log("npx wrangler deploy")
