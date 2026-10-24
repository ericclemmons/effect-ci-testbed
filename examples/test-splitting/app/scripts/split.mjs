// Both algorithms operate on a stable, complete candidate list.
export function split(candidates, total, timings = {}) {
  if (!Number.isInteger(total) || total < 1) throw new Error("total must be a positive integer")
  const sorted = [...new Set(candidates)].sort()
  const shards = Array.from({ length: total }, () => [])
  sorted.forEach((file, index) => shards[index % total].push(file))
  return shards
}
