import { rm } from "node:fs/promises"

await rm(".effect-ci-state/schema-version", { force: true })
console.log("npx wrangler d1 migrations apply DATABASE --remote # down migration")
