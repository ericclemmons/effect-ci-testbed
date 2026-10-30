interface Check {
  id: number
  name: string
  head_sha: string
  status: string
  conclusion: string | null
  html_url: string
  app: { slug: string }
}

export function loadReadiness() {
  const panel = document.querySelector<HTMLElement>("[data-readiness]")
  if (!panel || panel.dataset.initialized) return
  panel.dataset.initialized = "true"
  const summary = panel.querySelector<HTMLElement>("[data-summary]")!
  const progress = panel.querySelector<HTMLProgressElement>("[data-progress]")!
  const revision = panel.querySelector<HTMLAnchorElement>("[data-revision]")!
  const refresh = panel.querySelector<HTMLButtonElement>("[data-refresh]")!
  const cells = Array.from(panel.querySelectorAll<HTMLAnchorElement>("[data-cell]"))

  async function read(path: string) {
    const response = await fetch(`https://api.github.com/repos/ericclemmons/effect-ci-testbed/${path}`, {
      headers: { Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`)
    return response.json()
  }

  async function update() {
    refresh.disabled = true
    summary.textContent = "Loading checks from main…"
    progress.value = 0
    for (const cell of cells) {
      delete cell.dataset.passing
      cell.textContent = "×"
      cell.title = `${cell.dataset.feature} · ${cell.dataset.environment}: checks not loaded`
      cell.setAttribute("aria-label", cell.title)
    }
    try {
      const { sha } = await read("commits/main")
      if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("GitHub did not return a commit")
      const checks = new Map<string, Check>()
      let count = 0
      for (let page = 1; ; page++) {
        const { check_runs, total_count } = await read(`commits/${sha}/check-runs?filter=latest&per_page=100&page=${page}`)
        if (!Array.isArray(check_runs) || !Number.isInteger(total_count)) throw new Error("Invalid check response")
        for (const check of check_runs as Check[]) {
          if (check.head_sha !== sha) continue
          const key = `${check.app.slug}:${check.name}`
          if (check.id > (checks.get(key)?.id ?? 0)) checks.set(key, check)
        }
        count += check_runs.length
        if (count >= total_count) break
        if (!check_runs.length || page >= 50) throw new Error("Incomplete check response")
      }
      let passed = 0
      for (const cell of cells) {
        const names: string[] = JSON.parse(cell.dataset.names!)
        const check = names.map(name => checks.get(`${cell.dataset.app}:${name}`)).find(Boolean)
        const passing = check?.status === "completed" && check.conclusion === "success"
        if (passing) { cell.dataset.passing = "true"; cell.textContent = "✓"; passed++ }
        const state = check ? `${check.name}: ${check.status === "completed" ? check.conclusion : check.status}` : "missing check"
        cell.title = `${cell.dataset.feature} · ${cell.dataset.environment}: ${state}`
        cell.setAttribute("aria-label", cell.title)
        // Keep navigation on GitHub even if a check producer supplied an external URL.
        cell.href = check ? `https://github.com/ericclemmons/effect-ci-testbed/runs/${check.id}` :
          `https://github.com/ericclemmons/effect-ci-testbed/commit/${sha}/checks`
      }
      progress.value = passed
      revision.textContent = `main · ${sha.slice(0, 7)}`
      revision.href = `https://github.com/ericclemmons/effect-ci-testbed/commit/${sha}`
      summary.textContent = `${passed} / ${cells.length} passing · ${Math.round(passed / cells.length * 100)}% · ${count} GitHub checks`
    } catch (error) {
      summary.textContent = `Checks unavailable. ${error instanceof Error ? error.message : "Could not reach GitHub"}. Red squares are unverified; refresh to retry.`
    } finally { refresh.disabled = false }
  }
  refresh.addEventListener("click", update)
  void update()
}
