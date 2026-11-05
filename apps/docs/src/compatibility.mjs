export const environments = ["GitHub Actions", "Effect CI (local)", "Effect CI on GitHub Actions", "Effect CI on Cloudflare", "cf ci"]

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
    const link = feature.match(/\[([^\]]+)\]\(([^)]+)\)/)
    const [, title, target] = link ?? []
    const recipe = target?.match(/^\.\/([^/#)]+)/)?.[1]
    group.rows.push({ title: title ?? feature, recipe, link: target, cells: cells.map(cell => cell !== "—") })
  }
  const listed = new Set(groups.flatMap(group => group.rows.map(row => row.recipe)))
  const extra = Object.entries(readmes)
    .map(([path, body]) => {
      const [, recipe] = path.match(/examples\/([^/]+)\/README\.md$/)
      return { recipe, link: `./${recipe}`, title: body.match(/^# (.+)/m)?.[1] ?? recipe, cells: environments.map(environment => environment !== "cf ci") }
    })
    .filter(row => !listed.has(row.recipe))
    .sort((a, b) => a.recipe.localeCompare(b.recipe))
  if (extra.length) groups.push({ title: "More examples", rows: extra })
  return groups
}

export function checkNames(recipe, environment) {
  if (!recipe) return []
  if (environment === "GitHub Actions") return [recipe.startsWith("oidc-") ? `${recipe} / github / live deployment` : `${recipe} / github`]
  if (environment === "Effect CI (local)") return [`${recipe} / local / execute`, `${recipe} / Cloudflare local runtime`]
  if (environment === "Effect CI on GitHub Actions") return [`${recipe} / effect-on-github / execute`]
  // cf ci has no runner yet; its cells stay `—` in COVERAGE.md until one exists.
  if (environment === "cf ci") return [`${recipe} / cf-ci / execute`]
  return [`Cloudflare / ${recipe}`]
}
