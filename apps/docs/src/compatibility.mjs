export const environments = ["GitHub Actions", "Effect CI Local", "Effect CI GitHub", "Effect CI Hosted"]

// Reuse the maintained coverage catalog's ordering and applicability, never its manual colors.
export function compatibility(coverage, readmes) {
  const groups = []
  let group
  for (const line of coverage.split("\n")) {
    if (line.startsWith("### ")) {
      group = { title: line.slice(4), rows: [] }
      groups.push(group)
    }
    if (!group || !line.startsWith("| ") || /^\| (Recipe|---)/.test(line)) continue
    const [feature, ...cells] = line.split("|").slice(1, -1).map(cell => cell.trim())
    const link = feature.match(/\[([^\]]+)\]\(\.\/([^/#)]+)(?:#[^)]*)?\)/)
    const [, title, recipe] = link ?? []
    group.rows.push({ title: title ?? feature, recipe, cells: cells.map(cell => cell !== "—") })
  }
  const listed = new Set(groups.flatMap(group => group.rows.map(row => row.recipe)))
  const extra = Object.entries(readmes)
    .map(([path, body]) => {
      const [, recipe] = path.match(/examples\/([^/]+)\/README\.md$/)
      return { recipe, title: body.match(/^# (.+)/m)?.[1] ?? recipe, cells: environments.map(() => true) }
    })
    .filter(row => !listed.has(row.recipe))
    .sort((a, b) => a.recipe.localeCompare(b.recipe))
  if (extra.length) groups.push({ title: "More examples", rows: extra })
  return groups
}

export function checkNames(recipe, environment) {
  if (!recipe) return []
  if (environment === "GitHub Actions") return [recipe.startsWith("oidc-") ? `${recipe} / github / live deployment` : `${recipe} / github`]
  if (environment === "Effect CI Local") return [`${recipe} / local / execute`, `${recipe} / Cloudflare local runtime`]
  if (environment === "Effect CI GitHub") return [`${recipe} / effect-on-github / execute`]
  return [`Cloudflare / ${recipe}`]
}
