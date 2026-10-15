import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { prepareStaticAssets } from "./static-assets-source.ts"
import { publishStaticAssets, verifyStaticAssets, reconcileStaticAssets, staticAssetsCsp } from "./static-assets-publish.ts"
import type { StaticAssetRevisions } from "./static-assets-journal.ts"
const revision = "a".repeat(40), version = "00000000-0000-0000-0000-000000000001", deployment = "00000000-0000-0000-0000-000000000002"
const oldDeployment = "00000000-0000-0000-0000-000000000003", oldVersion = "00000000-0000-0000-0000-000000000004"
const token = "private-account-token", uploadJwt = "private-session-token", completionJwt = "private-completion-token"
async function harness(options: { lost?: string; corrupt?: boolean; foreignBucket?: boolean; drift?: boolean; cached?: boolean; minimalDeploymentAck?: boolean } = {}) {
  const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, files: ["app.js", "index.html", "style.css"].map(name => ({ path: "site/" + name, base64: btoa(name), executable: false })) }))
  const manifestDigest = createHash("sha256").update(bytes).digest("hex"), prepared = await prepareStaticAssets(revision, bytes, manifestDigest)
  let claimed = false, pending: string | null = null, complete: any = null, metadata: any = null, active: any = { id: oldDeployment, versions: [{ version_id: oldVersion, percentage: 100 }] }, reads = 0
  const steps: Record<string, string> = {}, calls: { url: string; method: string }[] = [], intents: string[] = []
  const journal = {
    get: async () => ({ revision, manifestDigest, bytes, assetDigest: prepared.assetDigest }),
    begin: async () => { if (complete) return complete; if (claimed) throw Error("Unresolved publication"); claimed = true; return null },
    intent: async (_: string, step: string) => { if (pending || steps[step]) throw Error("Duplicate mutation"); pending = step; intents.push(step) },
    acknowledge: async (_: string, step: string, id: string) => { assert.equal(pending, step); steps[step] = id; pending = null },
    inspect: async () => ({ revision, assetDigest: prepared.assetDigest, pending, steps: { ...steps }, complete }),
    complete: async (_: string, v: string, d: string) => { assert.equal(pending, null); assert.equal(v, version); assert.equal(d, deployment); complete = { revision, manifestDigest, assetDigest: prepared.assetDigest, version, deployment, target: prepared.target, policy: prepared.policy }; return complete },
  } as unknown as Pick<StaticAssetRevisions, "get" | "begin" | "intent" | "acknowledge" | "inspect" | "complete">
  const transport: typeof fetch = async (input, init = {}) => {
    const url = String(input), method = init.method ?? "GET"; calls.push({ url, method })
    const result = (value: object, status = 200) => Response.json({ success: true, result: value }, { status })
    if (!url.startsWith("https://api.cloudflare.com/")) {
      assert.ok(url.startsWith("https://effect-ci-static-assets-demo.ericclemmons.workers.dev/")); assert.equal(new Headers(init.headers).has("authorization"), false)
      if (url.endsWith("/__proof")) return Response.json({ revision, manifestDigest, assetDigest: prepared.assetDigest })
      return new Response(options.corrupt ? "corrupt" : url.slice(url.lastIndexOf("/") + 1), { headers: { "content-security-policy": staticAssetsCsp, "x-content-type-options": "nosniff" } })
    }
    assert.ok(url.includes("/accounts/0db135ec469e2f216fcea26426f29755/workers/"))
    assert.equal(init.redirect, "manual")
    const auth = new Headers(init.headers).get("authorization")
    if (url.endsWith("/assets-upload-session")) {
      assert.equal(method, "POST"); assert.equal(auth, `Bearer ${token}`); assert.equal(pending, "session")
      assert.deepEqual(JSON.parse(String(init.body)).manifest, prepared.uploadManifest)
      if (options.lost === "session") throw Error(token + " response lost")
      return result({ jwt: uploadJwt, buckets: options.cached ? [] : [options.foreignBucket ? ["0".repeat(32)] : prepared.assets.map(asset => asset.uploadHash)] })
    }
    if (url.endsWith("/assets/upload?base64=true")) {
      assert.equal(method, "POST"); assert.equal(auth, `Bearer ${uploadJwt}`); assert.equal(pending, "assets:0")
      const form = init.body as FormData
      for (const asset of prepared.assets) assert.equal(await (form.get(asset.uploadHash) as Blob).text(), asset.base64)
      if (options.lost === "assets:0") throw Error(uploadJwt + " response lost")
      return result({ jwt: completionJwt }, 201)
    }
    assert.ok(url.includes("/scripts/effect-ci-static-assets-demo/")); assert.equal(auth, `Bearer ${token}`)
    if (url.endsWith("/versions") && method === "POST") {
      assert.equal(pending, "version")
      const form = init.body as FormData
      metadata = JSON.parse(await (form.get("metadata") as Blob).text())
      assert.equal(metadata.assets.jwt, options.cached ? uploadJwt : completionJwt)
      assert.deepEqual(metadata.assets.config, { html_handling: "none", run_worker_first: true })
      assert.deepEqual(metadata.bindings, [{ name: "ASSETS", type: "assets" }])
      assert.ok(!(await (form.get("index.js") as Blob).text()).includes(token))
      if (options.lost === "version") throw Error(token + " response lost")
      return result({ id: version })
    }
    if (url.endsWith(`/versions/${version}`)) return result({ id: version, annotations: metadata.annotations, resources: { bindings: [{ name: "ASSETS", type: "assets" }] } })
    if (url.endsWith("/deployments?per_page=1")) {
      reads++
      if (options.drift && reads === 2) return result({ deployments: [{ ...active, id: deployment }] })
      return result({ deployments: [active] })
    }
    if (url.endsWith("/deployments") && method === "POST") {
      assert.equal(pending, "deployment")
      const body = JSON.parse(String(init.body)); assert.deepEqual(body.versions, [{ version_id: version, percentage: 100 }])
      active = { id: deployment, versions: body.versions, annotations: body.annotations }
      if (options.lost === "deployment") throw Error(token + " response lost")
      return result(options.minimalDeploymentAck ? { id: deployment } : active)
    }
    assert.fail("Unexpected API request")
  }
  return { journal, transport, calls, intents, state: () => ({ pending, complete }) }
}
test("supported API sequence uses journalled fixed-target writes and separate served-byte completion", async () => {
  const h = await harness(), result = await publishStaticAssets(h.journal, revision, () => token, h.transport)
  assert.equal(result.version, version); assert.equal(h.state().complete, null)
  const completed = await verifyStaticAssets(h.journal, revision, () => token, h.transport)
  assert.equal(completed.deployment, deployment)
  assert.deepEqual(h.intents, ["session", "assets:0", "version", "deployment"])
  assert.equal(h.calls.filter(c => c.method === "POST").length, 4)
  assert.doesNotMatch(JSON.stringify(completed), /private-/)
  const count = h.calls.length
  assert.equal((await publishStaticAssets(h.journal, revision, () => { throw Error("No credential on historical replay") }, h.transport)).historicalReplay, true)
  assert.equal(h.calls.length, count)
})
test("lost acknowledgements hold without duplicate writes or leaked credentials", async () => {
  for (const lost of ["session", "assets:0", "version", "deployment"]) {
    const h = await harness({ lost })
    await assert.rejects(publishStaticAssets(h.journal, revision, () => token, h.transport), error => error instanceof Error && !/private-/.test(error.message))
    assert.equal(h.state().pending, lost)
    const writes = h.calls.filter(c => c.method === "POST").length
    await assert.rejects(publishStaticAssets(h.journal, revision, () => token, h.transport))
    if (lost === "deployment") {
      const receipt = await reconcileStaticAssets(h.journal, revision, () => token, h.transport)
      assert.equal(receipt.deployment, deployment)
    } else await assert.rejects(reconcileStaticAssets(h.journal, revision, () => token, h.transport))
    assert.equal(h.calls.filter(c => c.method === "POST").length, writes)
  }
})
test("foreign buckets, deployment drift and corrupt served bytes cannot complete", async () => {
  for (const options of [{ foreignBucket: true }, { drift: true }]) {
    const h = await harness(options)
    await assert.rejects(publishStaticAssets(h.journal, revision, () => token, h.transport))
    assert.equal(h.calls.some(c => c.url.endsWith("/deployments") && c.method === "POST"), false)
  }
  const h = await harness({ corrupt: true })
  await publishStaticAssets(h.journal, revision, () => token, h.transport)
  await assert.rejects(verifyStaticAssets(h.journal, revision, () => token, h.transport), /bytes mismatch/)
  assert.equal(h.state().complete, null)
})
test("already-uploaded assets require no redundant upload POST", async () => {
  const h = await harness({ cached: true })
  await publishStaticAssets(h.journal, revision, () => token, h.transport)
  await verifyStaticAssets(h.journal, revision, () => token, h.transport)
  assert.equal(h.calls.filter(c => c.url.includes("/assets/upload?")).length, 0)
})

test("deployment write acknowledgement is not a full allocation readback", async () => {
  const h = await harness({ minimalDeploymentAck: true })
  const result = await publishStaticAssets(h.journal, revision, () => token, h.transport)
  assert.equal(result.deployment, deployment)
  assert.equal(h.calls.filter(c => c.url.endsWith("/deployments") && c.method === "POST").length, 1)
  assert.equal((await verifyStaticAssets(h.journal, revision, () => token, h.transport)).deployment, deployment)
})
