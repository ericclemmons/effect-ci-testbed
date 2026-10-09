import assert from "node:assert/strict"
import test from "node:test"
import { cacheIdentity } from "../../../packages/cloudflare/src/cache-identity.ts"

const input = {
  repository: "https://github.com/owner/project.git",
  key: "install",
  paths: ["app/.cache"],
  container: { image: "node:24" },
  files: [["app/lock.json", "one"]] as const,
}

test("cache identity reuses identical inputs and invalidates changed files", async () => {
  const original = await cacheIdentity(input)
  assert.equal(await cacheIdentity({ ...input }), original)
  for (const change of [
    { files: [["app/lock.json", "two"]] as const },
    { files: [["app/lock.json", undefined]] as const },
    { files: [["app/lock.json", ""]] as const },
    { repository: "https://github.com/other/project.git" },
    { paths: ["other/.cache"] },
    { container: { image: "node:26" } },
  ]) assert.notEqual(await cacheIdentity({ ...input, ...change }), original)
})

test("cache identity is order-independent and rejects escaping key files", async () => {
  const files = [["a", "1"], ["b", "2"]] as const
  assert.equal(await cacheIdentity({ ...input, files }),
    await cacheIdentity({ ...input, files: [...files].reverse() }))
  for (const path of ["", "/secret", "../secret", "app/../../secret"]) {
    await assert.rejects(cacheIdentity({ ...input, files: [[path, "secret"]] }), /repository-relative/)
  }
})
