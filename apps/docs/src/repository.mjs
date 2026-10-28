import { globSync, readFileSync } from "node:fs"
import { dirname, extname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "@babel/parser"

export const root = fileURLToPath(new URL("../../../", import.meta.url))
export const repository = "https://github.com/ericclemmons/effect-ci-testbed"
export const patterns = [
  "README.md", "examples/*.md", "examples/*/README.md",
  "examples/*/*.md", "apps/*/*.md",
  "apps/repair-ai/scripts/README.md", "packages/*/*.md", "packages/cloudflare/src/*.md",
]

export function pages() {
  return [...new Set(globSync(patterns, { cwd: root }))].filter(path => !path.endsWith("/AGENTS.md")).sort().map((path) => {
    const body = readFileSync(resolve(root, path), "utf8")
    const id = path === "examples/demo/README.md" ? "walkthrough" : path.replace(/(^|\/)README\.md$/, "").replace(/\.md$/, "").toLowerCase() || "index"
    return { path, id, body, title: body.match(/^# (.+)$/m)?.[1] ?? path }
  }).flatMap(page => page.id === "walkthrough" ? [{ ...page, id: "examples/demo" }, page] : [page])
}

export const href = (id) => id === "index" ? "/" : `/${id}/`

export function sidebar() {
  const docs = pages()
  const recipes = new Map(docs.filter((page) => /^examples\/[^/]+\/README\.md$/.test(page.path))
    .map((page) => [page.path.split("/")[1], page]))
  const groups = []
  const ecosystem = ["node-npm", "node-pnpm", "vite-plus-cache", "turborepo-cache", "github-cloudflare-ci", "gitlab-source", "cloudflare-runner", "blacksmith"]
  const used = new Set(["demo", ...ecosystem])
  for (const section of readFileSync(resolve(root, "examples/README.md"), "utf8").split(/^## /m).slice(1)) {
    const items = []
    for (const [, name] of section.matchAll(/\]\(\.\/([^/#)]+)/g)) {
      if (!recipes.has(name) || used.has(name)) continue
      used.add(name)
      items.push({ label: recipes.get(name).title, slug: recipes.get(name).id })
    }
    if (items.length) groups.push({ label: section.split("\n")[0], collapsed: true, items })
  }
  const extra = [...recipes].filter(([name]) => !used.has(name))
    .map(([, page]) => ({ label: page.title, slug: page.id }))
  if (extra.length) groups.push({ label: "More examples", collapsed: true, items: extra })
  return [
    { label: "Features", link: "/" },
    { label: "Walkthrough", slug: "walkthrough" },
    { label: "Ecosystem", collapsed: true, items: [
      { label: "Tools and cache ownership", slug: "examples/ecosystem" },
      { label: "GitHub", slug: "examples/github" },
      ...ecosystem.map(name => ({ label: recipes.get(name).title, slug: recipes.get(name).id })),
    ] },
    { label: "Recipes", collapsed: true, items: [{ label: "Find a recipe", slug: "examples" }, ...groups] },
    { label: "Reference", collapsed: true, items: [
      { label: "CLI", slug: "packages/cli" },
      { label: "SDK", slug: "packages/ci" },
      { label: "Execution evidence", slug: "examples/coverage" },
      { label: "Self-hosting", slug: "apps/effect-ci" },
      { label: "Repository wiring", slug: "apps/docs/laboratory" },
      { label: "Packages", items: [{ autogenerate: { directory: "packages" } }] },
      { label: "Hosts and services", items: [{ autogenerate: { directory: "apps" } }] },
    ] },
  ]
}

function target(url, from) {
  const [path, fragment] = url.split("#")
  const absolute = resolve(dirname(from), decodeURI(path))
  if (relative(root, absolute).startsWith("..")) throw new Error(`Documentation points outside the repository: ${url}`)
  return { absolute, path: relative(root, absolute), fragment }
}

function snippet(url, from) {
  const file = target(url, from)
  let value = readFileSync(file.absolute, "utf8").trimEnd()
  let lines = ""
  if (file.fragment?.startsWith("symbol=")) {
    const name = file.fragment.slice(7)
    const source = parse(value, { sourceType: "module", plugins: ["typescript"] })
    let statements = source.program.body
    let statement
    for (const part of name.split(".")) {
      statement = statements.find((node) => {
        const declaration = node.type === "ExportNamedDeclaration" ? node.declaration : node
        return declaration?.id?.name === part ||
          declaration?.declarations?.some((item) => item.id.name === part) ||
          (part === "default" && node.type === "ExportDefaultDeclaration")
      })
      const declaration = statement?.type === "ExportNamedDeclaration" ? statement.declaration : statement
      statements = declaration?.body?.body ?? []
      if (!statement) break
    }
    if (!statement) throw new Error(`Missing documented symbol ${name} in ${file.path}`)
    const start = statement.loc.start.line
    const end = statement.loc.end.line
    value = value.slice(statement.start, statement.end)
    lines = `#L${start}-L${end}`
  } else if (file.fragment?.startsWith("json=")) {
    const key = file.fragment.slice(5)
    const data = JSON.parse(value)
    if (!(key in data)) throw new Error(`Missing documented JSON key ${key} in ${file.path}`)
    value = JSON.stringify({ [key]: data[key] }, null, 2)
  } else if (file.fragment) {
    throw new Error(`Unknown source selector: ${url}`)
  }
  const language = { ".ts": "ts", ".mts": "ts", ".js": "js", ".mjs": "js", ".json": "json", ".yml": "yaml", ".yaml": "yaml" }[extname(file.path)] ?? "text"
  return { ...file, value, language, url: `${repository}/blob/main/${file.path}${lines}` }
}

/** Standard Markdown source links stay clickable on GitHub and expand on the site. */
export function repositoryMarkdown() {
  const docs = new Map(pages().map((page) => [page.path, page.id]))
  return (tree, file) => {
    const from = file.path
    if (!from) throw new Error("Repository Markdown needs its original file path")
    function rewrite(url, image = false) {
      if (!url || /^(?:[a-z]+:|\/|#)/i.test(url)) return url
      const destination = target(url, from)
      const doc = docs.get(destination.path) ?? docs.get(`${destination.path}/README.md`)
      if (!image && doc) return href(doc) + (destination.fragment ? `#${destination.fragment}` : "")
      return `${repository}/${image ? "raw" : "blob"}/main/${destination.path}${destination.fragment ? `#${destination.fragment}` : ""}`
    }
    function walk(node) {
      if (!node.children) return
      node.children = node.children.flatMap((child) => {
        if (child.type === "paragraph" && child.children.length === 1 && child.children[0].type === "link" && child.children[0].title === "source") {
          const link = child.children[0]
          const code = snippet(link.url, from)
          link.url = code.url
          link.title = null
          return [child, { type: "code", lang: code.language, meta: `title="${code.path}"`, value: code.value }]
        }
        if (child.type === "link" || child.type === "image") child.url = rewrite(child.url, child.type === "image")
        if (child.type === "html") child.value = child.value.replace(/\b(src|href)="([^"]+)"/g, (_, attribute, url) => `${attribute}="${rewrite(url, attribute === "src")}"`)
        if (child.type === "code" && child.lang === "mermaid") {
          const escaped = child.value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
          return [{ type: "html", value: `<pre class="mermaid">${escaped}</pre>` }]
        }
        walk(child)
        return [child]
      })
    }
    walk(tree)
  }
}

export function dependencies(page) {
  return [resolve(root, page.path), ...[...page.body.matchAll(/\]\(([^\s)]+) "source"\)/g)]
    .map(([, url]) => target(url, resolve(root, page.path)).absolute)]
}
