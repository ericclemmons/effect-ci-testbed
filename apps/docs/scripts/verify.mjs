import assert from "node:assert/strict"
import { existsSync, globSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pages, root } from "../src/repository.mjs"

const dist = resolve(import.meta.dirname, "../dist")
const decode = (text) => text.replace(/<[^>]*>/g, "")
  .replace(/&#x([\da-f]+);/gi, (_, value) => String.fromCodePoint(parseInt(value, 16)))
  .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)))
  .replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&lt;", "<")
  .replaceAll("&gt;", ">").replaceAll("&amp;", "&")
const html = (id) => readFileSync(resolve(dist, id === "index" ? "index.html" : `${id}/index.html`), "utf8")
const normalized = (text) => decode(text.replaceAll('<div class="ec-line">', "\n")).replace(/\s+/g, " ").trim()

for (const page of pages()) {
  const body = html(page.id)
  assert.ok(body.includes("<h1"), `Missing document: ${page.path}`)
  for (const [, link] of body.matchAll(/<a\b[^>]*href="(\/[^"#]*)[^"]*"/g)) {
    const path = decodeURI(link.split("?")[0])
    const output = resolve(dist, `.${path}`, path.endsWith("/") ? "index.html" : "")
    assert.ok(existsSync(output), `${page.path}: missing site destination ${link}`)
  }
}

// Verify the actual rendered examples against their independently read source.
const workflow = readFileSync(resolve(root, "examples/exported-actions/.cloudflare/ci/workflow.ts"), "utf8").trim()
assert.ok(normalized(html("examples/exported-actions")).includes(normalized(workflow)), "Workflow snippet drifted from source")
const manifest = JSON.parse(readFileSync(resolve(root, "examples/demo/package.json"), "utf8"))
assert.ok(normalized(html("examples/demo")).includes(normalized(JSON.stringify({ scripts: manifest.scripts }, null, 2))), "Script snippet drifted from package.json")
assert.ok([...globSync("pagefind/*.js", { cwd: dist })].length > 0, "Missing search index")
console.log(`Verified ${pages().length} README routes, internal page links, source snippets, and search assets`)
