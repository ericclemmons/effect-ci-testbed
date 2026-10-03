import { mkdir, writeFile } from "node:fs/promises"

await mkdir(".effect-ci-state", { recursive: true })
await writeFile(".effect-ci-state/schema-version", "0001_create_users\n")
console.log("npx wrangler d1 migrations apply DATABASE --remote")
