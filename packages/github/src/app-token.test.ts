import assert from "node:assert/strict"
import { generateKeyPairSync } from "node:crypto"
import test from "node:test"
import { createInstallationToken } from "./app.ts"

test("checkout installation tokens are restricted to one repository and Contents read", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } })
  const original = globalThis.fetch
  let scoped = true
  globalThis.fetch = async (_url, options) => {
    if (scoped) assert.deepEqual(JSON.parse(String(options!.body)), { repositories: ["private"], permissions: { contents: "read" } })
    else assert.deepEqual(JSON.parse(String(options!.body)), {
      permissions: { contents: "read", checks: "write", pull_requests: "write" },
    }, "ordinary reporting cannot inherit the parent App's Contents write permission")
    return Response.json({ token: "test-token" })
  }
  try {
    assert.equal(await createInstallationToken({ appId: "1", privateKey }, 2, "private"), "test-token")
    scoped = false
    assert.equal(await createInstallationToken({ appId: "1", privateKey }, 2), "test-token")
    await assert.rejects(createInstallationToken({ appId: "1", privateKey }, 2, "owner/private"), /Invalid GitHub checkout repository/)
    globalThis.fetch = async () => new Response("reflected-secret", { status: 403 })
    await assert.rejects(createInstallationToken({ appId: "1", privateKey }, 2, "private"), /^Error: GitHub installation token failed \(403\)$/)
  } finally { globalThis.fetch = original }
})
