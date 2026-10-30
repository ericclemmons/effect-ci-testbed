import { WorkerEntrypoint } from "cloudflare:workers"
import { createAppJwt } from "../../../packages/github/src/app.ts"

async function snapshot(read: (path: string) => Promise<any>) {
  const { sha } = await read("commits/main")
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("GitHub did not return a commit")
  const checks = new Map<string, { id: number; name: string; head_sha: string; status: string; conclusion: string | null; app: { slug: string } }>()
  let count = 0
  for (let page = 1; ; page++) {
    const { check_runs, total_count } = await read(`commits/${sha}/check-runs?filter=latest&per_page=100&page=${page}`)
    if (!Array.isArray(check_runs) || !Number.isInteger(total_count)) throw new Error("Invalid check response")
    for (const check of check_runs) {
      if (check.head_sha !== sha) continue
      const key = `${check.app.slug}:${check.name}`
      if (check.id > (checks.get(key)?.id ?? 0)) {
        const { id, name, head_sha, status, conclusion, app: { slug } } = check
        checks.set(key, { id, name, head_sha, status, conclusion, app: { slug } })
      }
    }
    count += check_runs.length
    if (count >= total_count) break
    if (!check_runs.length || page >= 50) throw new Error("Incomplete check response")
  }
  return { sha, check_runs: [...checks.values()], total_count: count, fetchedAt: new Date().toISOString(), active: !checks.size || [...checks.values()].some(check => check.status !== "completed") }
}

/** Fixed public-repository reader. Tokens stay on the CI host and are revoked after each read. */
export class DocsReadiness extends WorkerEntrypoint<{ GITHUB_APP_ID: string; GITHUB_PRIVATE_KEY: string }> {
  async read() {
    if (this.env.GITHUB_APP_ID !== "5089816") throw new Error("Docs checks unavailable")
    const jwt = await createAppJwt({ appId: this.env.GITHUB_APP_ID, privateKey: this.env.GITHUB_PRIVATE_KEY })
    const headers = (token: string) => ({
      Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`,
      "User-Agent": "effect-ci-docs", "Content-Type": "application/json",
    })
    const minted = await fetch("https://api.github.com/app/installations/165265172/access_tokens", {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000), headers: headers(jwt),
      body: JSON.stringify({ repositories: ["effect-ci-testbed"], permissions: { contents: "read", checks: "read" } }),
    })
    if (!minted.ok) throw new Error("Docs checks unavailable")
    const { token, permissions } = await minted.json() as { token: string; permissions: Record<string, string> }
    if (typeof token !== "string" || !/^[\x21-\x7e]{1,1024}$/.test(token)) throw new Error("Docs checks unavailable")
    try {
      if (permissions?.contents !== "read" || permissions?.checks !== "read" ||
        Object.entries(permissions).some(([name, value]) => !["contents", "checks", "metadata"].includes(name) || value !== "read"))
        throw new Error("Docs checks unavailable")
      return await snapshot(async path => {
        const response = await fetch(`https://api.github.com/repos/ericclemmons/effect-ci-testbed/${path}`, {
          headers: headers(token), redirect: "manual", signal: AbortSignal.timeout(10_000),
        })
        if (!response.ok) throw new Error("Docs checks unavailable")
        return response.json()
      })
    } finally {
      const revoked = await fetch("https://api.github.com/installation/token", {
        method: "DELETE", redirect: "manual", signal: AbortSignal.timeout(10_000), headers: headers(token),
      })
      await revoked.body?.cancel()
      if (revoked.status !== 204) throw new Error("Docs checks unavailable")
    }
  }
  fetch() { return new Response("Not found", { status: 404 }) }
}
