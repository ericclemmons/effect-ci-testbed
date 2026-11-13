export const environments = ["GitHub Actions", "Effect CI (local)", "Effect CI on GitHub Actions", "Effect CI on Cloudflare", "cf ci"]

// Implementations to compare side by side. `headline` is the environment whose coverage the product is judged by.
export const products = [
  { id: "github", label: "GitHub Actions", headline: "GitHub Actions" },
  { id: "effect", label: "Effect CI", headline: "Effect CI on Cloudflare" },
  { id: "cf-ci", label: "cf ci", headline: "cf ci" },
]

const effectOrder = ["workflow.ts", "ci.ts", "actions.ts"]

// Source files that implement a recipe for each product, in reading order, from paths relative to examples/<recipe>/.
export function implementationFiles(recipe, paths) {
  const prefix = `examples/${recipe}/`
  const own = paths.filter(path => path.startsWith(prefix)).map(path => path.slice(prefix.length))
  const rank = name => (effectOrder.indexOf(name) + 1 || effectOrder.length + 1)
  return {
    github: own.filter(path => path === ".github/workflows/github.yml"),
    effect: own.filter(path => /^\.cloudflare\/ci\/[^/]+\.ts$/.test(path))
      .sort((a, b) => rank(a.split("/").at(-1)) - rank(b.split("/").at(-1)) || a.localeCompare(b)),
    "cf-ci": own.filter(path => path === ".cloudflare/cf-ci/src/index.ts"),
  }
}

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
  // The recipe's .cloudflare/cf-ci pipeline writes this check itself through the GitHub app; recipes without one stay `—` in COVERAGE.md.
  if (environment === "cf ci") return [`${recipe} / cf-ci`]
  return [`Cloudflare / ${recipe}`]
}

// The GitHub App that writes each environment's checks.
export function checkApp(environment) {
  if (environment === "Effect CI on Cloudflare") return "effect-ci"
  if (environment === "cf ci") return "cloudflare-workers-and-pages"
  return "github-actions"
}
