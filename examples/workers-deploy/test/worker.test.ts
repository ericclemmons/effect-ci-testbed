import assert from "node:assert/strict"
import test from "node:test"

import worker from "../src/index.ts"

const fetch = (path: string) =>
  worker.fetch(new Request(`https://example.com${path}`) as never)

test("serves the home page", async () => {
  const response = await fetch("/")

  assert.equal(response.status, 200)
  assert.equal(await response.text(), "Hello from Cloudflare Workers")
})

test("reports health", async () => {
  assert.deepEqual(await (await fetch("/health")).json(), { ok: true })
})
