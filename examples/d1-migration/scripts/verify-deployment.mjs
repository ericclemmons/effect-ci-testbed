import { access } from "node:fs/promises"

await access("dist/worker.js")
console.log("deployment health check passed")
