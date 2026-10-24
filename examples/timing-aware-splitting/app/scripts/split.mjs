// Both algorithms operate on a stable, complete candidate list.
export function split(candidates, total, timings = {}) {
  if (!Number.isInteger(total) || total < 1) throw new Error("total must be a positive integer")
  const sorted = [...new Set(candidates)].sort()
  const shards = Array.from({ length: total }, () => [])
  // Missing candidates receive the median known duration; a first run uses 1.
  const known = sorted.map((file) => timings[file]).filter((time) => Number.isFinite(time) && time > 0).sort((a, b) => a - b)
  const fallback = known.length ? known[Math.floor(known.length / 2)] : 1
  const weight = (file) => Number.isFinite(timings[file]) && timings[file] > 0 ? timings[file] : fallback
  const loads = Array(total).fill(0)
  sorted.sort((a, b) => weight(b) - weight(a) || a.localeCompare(b))
  for (const file of sorted) {
    const index = loads.indexOf(Math.min(...loads))
    shards[index].push(file)
    loads[index] += weight(file)
  }
  return shards
}
