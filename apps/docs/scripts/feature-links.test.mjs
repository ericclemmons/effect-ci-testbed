import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { test } from "node:test"

const output = resolve(import.meta.dirname, "../dist")
const homepage = readFileSync(resolve(output, "index.html"), "utf8")
const links = [...homepage.matchAll(/<th scope="row"[^>]*>\s*<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)]
  .map(([, href, title]) => ({ href, title }))

test("feature links reach the relevant guides and sections", () => {
  for (const [title, href] of [
    ["Run CI remotely from the CLI", "/walkthrough/#7-enroll-oidc-and-run-on-a-host"],
    ["Request release approval in Discord", "/apps/effect-ci/#discord--slack-notifications-and-hitl"],
    ["Recover from a deploy failure after migration", "/examples/d1-migration/#rollback-is-not-filesystem-rewind"],
  ]) assert.equal(links.find(link => link.title === title)?.href, href)
})

test("every linked feature has a built page and section", () => {
  assert.ok(links.length > 50, "Feature table links must be present")
  for (const { href, title } of links) {
    const url = new URL(href, "https://docs.example")
    const page = readFileSync(resolve(output, `.${url.pathname}`, "index.html"), "utf8")
    if (url.hash) assert.ok(page.includes(`id="${url.hash.slice(1)}"`), `${title}: ${href}`)
  }
})
