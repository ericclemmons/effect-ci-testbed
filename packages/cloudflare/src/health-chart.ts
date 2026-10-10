import type { HealthDecision } from "./health-gate.ts"

export interface HealthPoint { readonly elapsedSeconds: number; readonly decision: HealthDecision }
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")

/** Historical confidence envelope, not a forecast cone. No scripts, external assets or raw logs. */
export function healthChart(points: ReadonlyArray<HealthPoint>, options: { baseline: string; candidate: string; maxErrorRate: number }): string {
  if (!points.length || points.length > 100 || !Number.isFinite(options.maxErrorRate) || options.maxErrorRate < 0 || options.maxErrorRate > 1) throw new Error("Invalid chart input")
  const plot = points.filter((p) => p.decision.baseline && p.decision.candidate)
  let previous = -1
  for (const p of points) {
    if (!Number.isFinite(p.elapsedSeconds) || p.elapsedSeconds < 0 || p.elapsedSeconds <= previous) throw new Error("Chart times must increase")
    previous = p.elapsedSeconds
    for (const interval of [p.decision.baseline, p.decision.candidate]) {
      if (interval && (![interval.low, interval.rate, interval.high].every(Number.isFinite) || interval.low < 0 || interval.high > 1 || interval.rate < interval.low || interval.rate > interval.high)) throw new Error("Invalid chart interval")
    }
  }
  const maxX = Math.max(1, points.at(-1)!.elapsedSeconds)
  const maxY = Math.max(0.01, options.maxErrorRate, ...plot.flatMap((p) => [p.decision.baseline!.high, p.decision.candidate!.high]))
  const x = (p: HealthPoint) => 70 + 620 * p.elapsedSeconds / maxX
  const y = (rate: number) => 260 - 180 * rate / maxY
  const band = (cohort: "baseline" | "candidate", color: string) => {
    const upper = plot.map((p) => `${x(p).toFixed(2)},${y(p.decision[cohort]!.high).toFixed(2)}`)
    const lower = [...plot].reverse().map((p) => `${x(p).toFixed(2)},${y(p.decision[cohort]!.low).toFixed(2)}`)
    const line = plot.map((p) => `${x(p).toFixed(2)},${y(p.decision[cohort]!.rate).toFixed(2)}`).join(" ")
    const observations = plot.map((p) => `<path d="M${x(p).toFixed(2)} ${y(p.decision[cohort]!.low).toFixed(2)}V${y(p.decision[cohort]!.high).toFixed(2)}" stroke="${color}" opacity="0.5"/><circle cx="${x(p).toFixed(2)}" cy="${y(p.decision[cohort]!.rate).toFixed(2)}" r="3" fill="${color}"/>`).join("")
    return `<polygon points="${[...upper, ...lower].join(" ")}" fill="${color}" opacity="0.18"/><polyline points="${line}" fill="none" stroke="${color}" stroke-width="2"/>${observations}`
  }
  const status = points.at(-1)!.decision.status
  const annotation = plot.length ? `Decision: ${status}` : "Needs more independent data — no confidence estimate yet"
  return `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="350" viewBox="0 0 760 350" role="img" aria-labelledby="title desc"><title id="title">Release error-rate confidence envelope</title><desc id="desc">${escape(annotation)}. Previous window versus candidate window; shading shows simultaneous anytime-valid bounds, not a traffic forecast.</desc><rect width="760" height="350" fill="#ffffff"/><g font-family="sans-serif" font-size="13" fill="#172033"><text x="30" y="28">Release health · ${escape(annotation)}</text><text x="70" y="52" fill="#2563eb">Previous: ${escape(options.baseline.slice(0, 40))}</text><text x="380" y="52" fill="#c2410c">Candidate: ${escape(options.candidate.slice(0, 40))}</text><path d="M70 80V260H690" fill="none" stroke="#94a3b8"/><text x="10" y="85">${(100 * maxY).toFixed(1)}%</text><text x="30" y="265">0%</text><text x="70" y="292">0s</text><text x="650" y="292">${maxX.toFixed(0)}s</text><text x="220" y="326">Independent observations accumulate; uncertainty can narrow.</text><path d="M70 ${y(options.maxErrorRate).toFixed(2)}H690" stroke="#dc2626" stroke-dasharray="5 4"/><text x="695" y="${y(options.maxErrorRate).toFixed(2)}">SLO</text>${band("baseline", "#2563eb")}${band("candidate", "#c2410c")}</g></svg>`
}
