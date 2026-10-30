import { readFile } from "node:fs/promises"

export const snapshotPath = new URL("../.cloudflare/state/readiness.json", import.meta.url)

// These checks belong to the publisher itself, not the feature matrix.
const publicationChecks = new Set(["Build documentation", "Publish documentation"])

export function validateSnapshot(snapshot) {
  if (!/^[a-f0-9]{40}$/.test(snapshot.sha) || !Number.isFinite(Date.parse(snapshot.fetchedAt)) ||
    !Array.isArray(snapshot.check_runs) || !snapshot.check_runs.length ||
    snapshot.check_runs.some(check => check.head_sha !== snapshot.sha || check.status !== "completed" ||
      !Number.isSafeInteger(check.id) || typeof check.name !== "string" || typeof check.app?.slug !== "string"))
    throw new Error("Readiness requires a complete snapshot for one commit")
  return snapshot
}

export async function github(path) {
  if (!process.env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is required to collect readiness checks")
  const response = await fetch(`https://api.github.com/repos/ericclemmons/effect-ci-testbed/${path}`, {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, "User-Agent": "effect-ci-docs" },
    redirect: "error", signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`GitHub readiness read failed (${response.status})`)
  return response.json()
}

export async function readSnapshot(sha, read = github) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Readiness requires a full commit SHA")
  const checks = new Map()
  let count = 0
  for (let page = 1; ; page++) {
    const { check_runs, total_count } = await read(`commits/${sha}/check-runs?filter=latest&per_page=100&page=${page}`)
    if (!Array.isArray(check_runs) || !Number.isSafeInteger(total_count)) throw new Error("Invalid GitHub checks response")
    for (const check of check_runs) {
      if (check.head_sha !== sha) throw new Error("GitHub check commit mismatch")
      if (check.app.slug === "github-actions" && publicationChecks.has(check.name)) continue
      const key = `${check.app.slug}:${check.name}`
      if (check.id > (checks.get(key)?.id ?? 0)) {
        const { id, name, head_sha, status, conclusion, app: { slug } } = check
        checks.set(key, { id, name, head_sha, status, conclusion, app: { slug } })
      }
    }
    count += check_runs.length
    if (count >= total_count) break
    if (!check_runs.length || page >= 50) throw new Error("Incomplete GitHub checks response")
  }
  return { sha, check_runs: [...checks.values()], total_count: checks.size, fetchedAt: new Date().toISOString() }
}

export const complete = snapshot => snapshot.check_runs.length > 0 && snapshot.check_runs.every(check => check.status === "completed")

export async function loadReadiness() {
  return validateSnapshot(JSON.parse(await readFile(snapshotPath, "utf8")))
}

export function cellResult(snapshot, names, app) {
  const check = names.map(name => snapshot.check_runs.find(check => check.app.slug === app && check.name === name)).find(Boolean)
  return {
    passing: check?.conclusion === "success",
    state: check ? `${check.name}: ${check.conclusion ?? "unverified"}` : "missing check",
    href: check ? `https://github.com/ericclemmons/effect-ci-testbed/runs/${check.id}` :
      `https://github.com/ericclemmons/effect-ci-testbed/commit/${snapshot.sha}/checks`,
  }
}
