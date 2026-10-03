import { mkdir, rm, writeFile } from "node:fs/promises"

await rm(".effect-ci-state", { force: true, recursive: true })
await mkdir("dist", { recursive: true })
await writeFile("dist/worker.js", "export default { fetch: () => new Response('ok') }\n")
console.log("built Worker")
