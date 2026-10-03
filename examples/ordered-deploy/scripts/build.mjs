import { mkdir, rm, writeFile } from "node:fs/promises"

await rm(".effect-ci-state", { force: true, recursive: true })
await mkdir("dist/backend", { recursive: true })
await mkdir("dist/frontend", { recursive: true })
await writeFile("dist/backend/worker.js", "export const service = 'backend'\n")
await writeFile("dist/frontend/worker.js", "export const service = 'frontend'\n")
console.log("built backend and frontend")
