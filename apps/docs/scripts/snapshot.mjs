import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { complete, github, loadReadiness, readSnapshot, snapshotPath, validateSnapshot } from "../src/readiness.mjs"

async function collect() {
  if (process.argv.includes("--verify-current")) {
    const snapshot = await loadReadiness()
    if ((await github("commits/main")).sha !== snapshot.sha) throw new Error("Main advanced; preserving the published docs")
    return
  }
  const sha = process.env.DOCS_READINESS_SHA
  let snapshot
  if (process.argv.includes("--wait")) {
    if (!/^[a-f0-9]{40}$/.test(sha ?? "")) throw new Error("DOCS_READINESS_SHA is required when waiting")
    const deadline = Date.now() + 30 * 60_000
    for (;;) {
      if ((await github("commits/main")).sha !== sha) {
        console.log("Main advanced; preserving the published docs")
        if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT, "ready=false\n", { flag: "a" })
        return
      }
      snapshot = await readSnapshot(sha)
      if (complete(snapshot)) break
      if (Date.now() >= deadline) throw new Error("Checks did not complete within 30 minutes; preserving the published docs")
      console.log(`Waiting for ${snapshot.check_runs.filter(check => check.status !== "completed").length} checks on ${sha.slice(0, 7)}`)
      await new Promise(resolve => setTimeout(resolve, 30_000))
    }
  } else if (process.env.DOCS_READINESS_SNAPSHOT) {
    snapshot = JSON.parse(await readFile(resolve(fileURLToPath(new URL("..", import.meta.url)), process.env.DOCS_READINESS_SNAPSHOT), "utf8"))
  } else if (sha) {
    snapshot = await readSnapshot(sha)
  } else {
    // Local and PR builds reuse the last published snapshot without GitHub credentials.
    const response = await fetch("https://effect-ci-docs.eclemmons.workers.dev/readiness.json", { redirect: "error", signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error(`Published readiness snapshot unavailable (${response.status})`)
    snapshot = await response.json()
  }
  validateSnapshot(snapshot)
  if (sha && snapshot.sha !== sha) throw new Error("Snapshot does not match DOCS_READINESS_SHA")
  await mkdir(dirname(fileURLToPath(snapshotPath)), { recursive: true })
  await writeFile(snapshotPath, JSON.stringify(snapshot))
  if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT, "ready=true\n", { flag: "a" })
  console.log(`Readiness: ${snapshot.check_runs.length} completed checks for ${snapshot.sha}`)
}

await collect()
