import type { CheckRun, CreateCheckOptions } from "./index.ts"

const transient = new Set([500, 502, 503, 504])
const delays = [250, 750, 1500]

/** Reporting metadata only. This is not a retry policy for commands or reviews. */
export async function createReportedCheck(
  options: CreateCheckOptions,
  body: string,
  headers: Record<string, string>,
  request: () => Promise<Response>,
): Promise<Response | CheckRun> {
  // These identities must come from the trusted token issuer and runner, not
  // from the PR. Older/unidentified callers retain one-shot creation.
  const recoverable = !!options.appSlug && /^[a-z0-9-]{1,100}$/.test(options.appSlug) &&
    !!options.externalId && options.externalId.length <= 512 &&
    /^[\w.-]+\/[\w.-]+$/.test(options.repository) && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(options.sha)
  const desired = JSON.parse(body)
  const reconcile = async (): Promise<CheckRun | undefined> => {
    const matches: any[] = []
    const ids = new Set<number>()
    let total: number | undefined
    for (let page = 1; page <= 10; page++) {
      const query = new URLSearchParams({ filter: "all", per_page: "100", page: String(page), check_name: options.name })
      const response = await fetch(`https://api.github.com/repos/${options.repository}/commits/${options.sha}/check-runs?${query}`, {
        method: "GET", headers, redirect: "manual", signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) throw Error("Cannot reconcile GitHub check creation: history unavailable")
      const history = await response.json() as { total_count: number; check_runs: any[] }
      if (!Number.isSafeInteger(history.total_count) || history.total_count < 0 || history.total_count > 1000 ||
        !Array.isArray(history.check_runs) || history.check_runs.length > 100 ||
        (total !== undefined && total !== history.total_count))
        throw Error("Cannot reconcile GitHub check creation: incomplete history")
      total = history.total_count
      for (const check of history.check_runs) {
        if (!Number.isSafeInteger(check?.id) || check.id <= 0 || ids.has(check.id))
          throw Error("Cannot reconcile GitHub check creation: invalid history")
        ids.add(check.id)
        if (check.app?.slug === options.appSlug && check.head_sha === options.sha &&
          check.external_id === options.externalId && check.name === options.name) matches.push(check)
      }
      if (ids.size === total) break
      if (history.check_runs.length !== 100 || page === 10 || ids.size > total)
        throw Error("Cannot reconcile GitHub check creation: incomplete history")
    }
    if (matches.length > 1) throw Error("Cannot reconcile GitHub check creation: ambiguous operation")
    const check = matches[0]
    if (!check) return
    if (check.status !== desired.status || (check.conclusion ?? null) !== (desired.conclusion ?? null) ||
      // GitHub fills an omitted details_url with the App's default homepage.
      (desired.details_url !== undefined && check.details_url !== desired.details_url) ||
      check.output?.title !== desired.output.title || check.output?.summary !== desired.output.summary ||
      (check.output?.text ?? null) !== (desired.output.text ?? null))
      throw Error("Cannot reconcile GitHub check creation: operation payload changed")
    return { id: check.id, htmlUrl: `https://github.com/${options.repository}/runs/${check.id}` }
  }

  for (let attempt = 0; ; attempt++) {
    // Transport exceptions remain uncertain and are never replayed here.
    const response = await request()
    if (response.ok || !recoverable || !transient.has(response.status)) return response
    const delay = delays[attempt]
    if (delay !== undefined) await new Promise(resolve => setTimeout(resolve, delay))
    // A 5xx may have committed. Adopt only our unique, unchanged operation;
    // never a same-named check from another App, run, or commit.
    const existing = await reconcile()
    if (existing) return existing
    if (delay === undefined) return response
    await response.arrayBuffer()
    // Reissue only this reporting POST after complete, empty reconciliation.
    // external_id is NOT a server idempotency key: delayed commits can still
    // produce duplicates. Ambiguous history fails closed; no exactly-once claim.
  }
}
