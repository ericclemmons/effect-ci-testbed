import type { HealthDecision, HealthSample } from "./health-gate.ts"

export interface HealthPoint {
  readonly elapsedSeconds: number
  readonly decision: HealthDecision
  readonly baselineSample?: HealthSample
  readonly candidateSample?: HealthSample
}
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")

/** Historical confidence envelope, not a forecast cone. No scripts, external assets or raw logs. */
export function healthChart(points: ReadonlyArray<HealthPoint>, options: { baseline: string; candidate: string; maxErrorRate: number }): string {
  if (!points.length || points.length > 100 || !Number.isFinite(options.maxErrorRate) || options.maxErrorRate < 0 || options.maxErrorRate > 1) throw new Error("Invalid chart input")
  let previous = -1
  for (const p of points) {
    if (!Number.isFinite(p.elapsedSeconds) || p.elapsedSeconds < 0 || p.elapsedSeconds <= previous) throw new Error("Chart times must increase")
    previous = p.elapsedSeconds
    for (const interval of [p.decision.baseline, p.decision.candidate]) {
      if (interval && (![interval.low, interval.rate, interval.high].every(Number.isFinite) || interval.low < 0 || interval.high > 1 || interval.rate < interval.low || interval.rate > interval.high)) throw new Error("Invalid chart interval")
    }
    for (const sample of [p.baselineSample, p.candidateSample]) {
      if (sample && (!Number.isSafeInteger(sample.trials) || !Number.isSafeInteger(sample.failures) ||
        sample.trials < 0 || sample.failures < 0 || sample.failures > sample.trials ||
        ![sample.from, sample.to].every(Number.isFinite) || sample.to <= sample.from)) throw new Error("Invalid chart sample")
    }
  }
  const maxX = Math.max(1, points.at(-1)!.elapsedSeconds)
  const maxY = Math.max(0.01, options.maxErrorRate, ...points.flatMap((p) => [p.decision.baseline?.high ?? 0, p.decision.candidate?.high ?? 0]))
  const x = (p: HealthPoint) => 70 + 620 * p.elapsedSeconds / maxX
  const y = (rate: number) => 370 - 120 * rate / maxY
  const band = (cohort: "baseline" | "candidate", color: string) => {
    // Each series is independent: missing candidate data must not hide the baseline.
    const plot = points.filter((p) => p.decision[cohort])
    const upper = plot.map((p) => `${x(p).toFixed(2)},${y(p.decision[cohort]!.high).toFixed(2)}`)
    const lower = [...plot].reverse().map((p) => `${x(p).toFixed(2)},${y(p.decision[cohort]!.low).toFixed(2)}`)
    const line = plot.map((p) => `${x(p).toFixed(2)},${y(p.decision[cohort]!.rate).toFixed(2)}`).join(" ")
    const observations = plot.map((p) => `<path d="M${x(p).toFixed(2)} ${y(p.decision[cohort]!.low).toFixed(2)}V${y(p.decision[cohort]!.high).toFixed(2)}" stroke="${color}" opacity="0.5"/><circle cx="${x(p).toFixed(2)}" cy="${y(p.decision[cohort]!.rate).toFixed(2)}" r="3" fill="${color}"/>`).join("")
    return `${plot.length > 1 ? `<polygon points="${[...upper, ...lower].join(" ")}" fill="${color}" opacity="0.18"/><polyline points="${line}" fill="none" stroke="${color}" stroke-width="2"/>` : ""}${observations}`
  }
  const latest = points.at(-1)!
  const percent = (rate: number) => `${(100 * rate).toFixed(2)}%`
  const annotation = latest.decision.status === "uncertain" ? "Not enough evidence to confirm safety" : `Decision: ${latest.decision.status}`
  const summary = (cohort: "baseline" | "candidate", label: string, version: string, color: string, top: number) => {
    const interval = latest.decision[cohort]
    const sample = cohort === "baseline" ? latest.baselineSample : latest.candidateSample
    const noData = sample?.trials === 0
    const rate = noData ? "No observations yet" : interval ? `${percent(interval.rate)} observed errors` : "No valid confidence estimate yet"
    const counts = sample ? `${sample.failures} errors / ${sample.trials} requests` : "Request counts unavailable"
    const bounds = interval ? `Confidence bounds ${percent(interval.low)}–${percent(interval.high)}` : "Comparison unavailable — no confidence estimate yet"
    const window = sample ? `${new Date(sample.from).toISOString().slice(11, 23)}–${new Date(sample.to).toISOString().slice(11, 23)} UTC` : "Window unavailable"
    return `<text x="30" y="${top}" fill="${color}" font-size="15">${label} · ${escape(version.slice(0, 40))}</text><text x="30" y="${top + 22}" font-size="17">${rate}</text><text x="390" y="${top + 22}">${counts}</text><text x="30" y="${top + 42}">${bounds}</text><text x="390" y="${top + 42}">${window}</text>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="460" viewBox="0 0 760 460" role="img" aria-labelledby="title desc"><title id="title">Previous versus new version · error rate</title><desc id="desc">${escape(annotation)}. Previous window versus candidate window; intervals show simultaneous anytime-valid bounds, not a forecast. Missing observations are not zero errors.</desc><rect width="760" height="460" fill="#fafbfd"/><g font-family="sans-serif" font-size="13" fill="#172033"><text x="30" y="28" font-size="19">Error rate · Previous vs new version</text><text x="30" y="52">${escape(annotation)}</text>${summary("baseline", "Previous", options.baseline, "#2563eb", 84)}${summary("candidate", "New", options.candidate, "#c2410c", 166)}<text x="30" y="230">Observed history · error-rate bounds</text><path d="M70 250V370H690" fill="none" stroke="#94a3b8"/><text x="10" y="255">${percent(maxY)}</text><text x="30" y="375">0%</text><text x="70" y="394">0s</text><text x="650" y="394">${maxX.toFixed(0)}s</text><text x="30" y="424">Error-rate limit: ${percent(options.maxErrorRate)} · Bounds are not proof of health.</text><text x="30" y="445">Observed windows only; not a forecast or proof of independent production traffic.</text><path d="M70 ${y(options.maxErrorRate).toFixed(2)}H690" stroke="#b91c1c" stroke-dasharray="5 4"/>${band("baseline", "#2563eb")}${band("candidate", "#c2410c")}</g></svg>`
}
