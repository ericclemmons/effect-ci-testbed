interface Check {
  id: number
  name: string
  head_sha: string
  status: string
  conclusion: string | null
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
  let timer: ReturnType<typeof setTimeout> | undefined
  let active = false
  let lastSummary = ""

  function poll() {
    timer = setTimeout(() => {
      if (!panel!.isConnected) return
      if (document.hidden) poll()
      else void update()
    }, 30_000)
  }

  async function update() {
    clearTimeout(timer)
    if (refresh.disabled) return
    refresh.disabled = true
    if (!lastSummary) {
      summary.textContent = "Loading checks from main…"
      progress.value = 0
      for (const cell of cells) {
        delete cell.dataset.passing
        cell.dataset.pending = "true"
        cell.textContent = "⏳"
        cell.title = `${cell.dataset.feature} · ${cell.dataset.environment}: checks not loaded`
        cell.setAttribute("aria-label", cell.title)
      }
    }
    try {
      const response = await fetch("/api/readiness", { cache: "no-store", signal: AbortSignal.timeout(25_000) })
      if (!response.ok) throw new Error("GitHub checks could not be loaded")
      const { sha, check_runs, total_count: count, fetchedAt, stale, active: running } = await response.json()
      if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("GitHub did not return a commit")
      if (!Array.isArray(check_runs) || !Number.isInteger(count) || !Number.isFinite(Date.parse(fetchedAt))) throw new Error("Invalid check response")
      active = running === true
      const checks = new Map<string, Check>()
      for (const check of check_runs as Check[]) {
        if (check.head_sha !== sha) continue
        checks.set(`${check.app.slug}:${check.name}`, check)
      }
      let passed = 0
      for (const cell of cells) {
        const names: string[] = JSON.parse(cell.dataset.names!)
        const check = names.map(name => checks.get(`${cell.dataset.app}:${name}`)).find(Boolean)
        const passing = check?.status === "completed" && check.conclusion === "success"
        const pending = check && check.status !== "completed"
        delete cell.dataset.passing
        if (pending) cell.dataset.pending = "true"
        else delete cell.dataset.pending
        cell.textContent = pending ? "⏳" : "×"
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
      lastSummary = `${passed} / ${cells.length} passing · ${Math.round(passed / cells.length * 100)}% · ${count} GitHub checks · ${stale ? "Refresh unavailable; cached" : "Checked"} ${new Date(fetchedAt).toLocaleString()}${active ? " · Refreshes every 30 seconds" : ""}`
      summary.textContent = lastSummary
    } catch (error) {
      if (lastSummary) {
        summary.textContent = `Refresh unavailable. ${lastSummary}`
        return
      }
      for (const cell of cells) {
        delete cell.dataset.passing
        delete cell.dataset.pending
        cell.textContent = "×"
        cell.title = `${cell.dataset.feature} · ${cell.dataset.environment}: checks unavailable`
        cell.setAttribute("aria-label", cell.title)
      }
      summary.textContent = `Checks unavailable. ${error instanceof Error ? error.message : "Could not reach GitHub"}. Red squares are unverified; refresh to retry.`
    } finally {
      refresh.disabled = false
      if (active && panel!.isConnected) poll()
    }
  }
  refresh.addEventListener("click", update)
  document.addEventListener("astro:before-swap", () => clearTimeout(timer), { once: true })
  void update()
}
