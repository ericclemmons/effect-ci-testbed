import { prepareStaticAssets, staticAssetsTarget } from "./static-assets-source.ts"
import type { StaticAssetReceipt, StaticAssetRevisions } from "./static-assets-journal.ts"

const account = "0db135ec469e2f216fcea26426f29755"
const apiRoot = `https://api.cloudflare.com/client/v4/accounts/${account}/workers`
const script = `${apiRoot}/scripts/${staticAssetsTarget}`
const origin = `https://${staticAssetsTarget}.ericclemmons.workers.dev`
export const staticAssetsCsp = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)
const sha = async (value: string | Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value))), b => b.toString(16).padStart(2, "0")).join("")
type Journal = Pick<StaticAssetRevisions, "get" | "begin" | "intent" | "acknowledge" | "inspect" | "complete">
const jwt = (value: unknown): value is string => typeof value === "string" && /^[\x21-\x7e]{1,8192}$/.test(value)

async function bounded(response: Response, limit: number) {
  if (!response.body || response.redirected) throw Error("Unavailable response")
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0
  try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length
    if (size > limit) throw Error("Response limit exceeded"); chunks.push(part.value)
  } } finally { await reader.cancel().catch(() => {}) }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return bytes
}
function api(token: () => string, transport: typeof fetch) {
  return async (url: string, method = "GET", body?: BodyInit, uploadToken?: string): Promise<any> => {
    let status: number | undefined
    try {
      const credential = uploadToken ?? token()
      if (!jwt(credential)) throw Error("Invalid credential")
      const response = await transport(url, { method, ...(body === undefined ? {} : { body }), redirect: "manual", signal: AbortSignal.timeout(20_000),
        headers: { authorization: `Bearer ${credential}`, ...(typeof body === "string" ? { "content-type": "application/json" } : {}) } })
      status = response.status
      if (!response.ok || response.status < 200 || response.status >= 300) { await response.body?.cancel(); throw Error("API rejected request") }
      const result = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await bounded(response, 128 * 1024)))
      if (result.success !== true || !result.result || typeof result.result !== "object") throw Error("Invalid API acknowledgement")
      return { status, value: result.result }
    } catch { throw Error(`Static Assets API unavailable${status === undefined ? "" : ` (HTTP ${status})`}`) }
  }
}
type Prepared = Awaited<ReturnType<typeof prepareStaticAssets>>
export function staticAssetsModule(prepared: Prepared) {
  const identity = JSON.stringify({ revision: prepared.revision, manifestDigest: prepared.manifestDigest, assetDigest: prepared.assetDigest })
  return `export default {async fetch(request,env){
    if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{allow:'GET, HEAD'}});
    const url=new URL(request.url);
    if(url.pathname==='/__proof')return new Response(request.method==='HEAD'?null:JSON.stringify(${identity}),{headers:{'content-type':'application/json','cache-control':'no-store'}});
    if(!['/','/index.html','/app.js','/style.css'].includes(url.pathname)||url.search)return new Response('Not found',{status:404});
    if(url.pathname==='/')url.pathname='/index.html';
    const response=await env.ASSETS.fetch(new Request(url,request));
    const headers=new Headers(response.headers);headers.set('content-security-policy',${JSON.stringify(staticAssetsCsp)});
    headers.set('x-content-type-options','nosniff');headers.set('cache-control','no-store');
    return new Response(request.method==='HEAD'?null:response.body,{status:response.status,headers});
  }};`
}
const message = (p: Prepared, moduleDigest: string) => `effect-ci-static:${p.assetDigest}:${moduleDigest}`
function allocation(value: any, version?: string) {
  if (!uuid(value?.id) || !Array.isArray(value.versions) || value.versions.length !== 1 || !uuid(value.versions[0]?.version_id) || value.versions[0].percentage !== 100 || version && value.versions[0].version_id !== version) throw Error("Static deployment allocation mismatch")
  return value
}
async function latest(request: ReturnType<typeof api>) {
  const { value } = await request(`${script}/deployments?per_page=1`)
  if (!Array.isArray(value.deployments) || value.deployments.length !== 1) throw Error("Static deployment readback unavailable")
  return allocation(value.deployments[0])
}
async function checkVersion(request: ReturnType<typeof api>, prepared: Prepared, version: string, moduleDigest: string) {
  const { value } = await request(`${script}/versions/${version}`)
  if (value.id !== version || value.annotations?.["workers/commit_sha"] !== prepared.revision ||
    value.annotations?.["workers/repository_url"] !== "https://github.com/ericclemmons/effect-ci-testbed" ||
    value.annotations?.["workers/message"] !== message(prepared, moduleDigest)) throw Error("Static version identity mismatch")
  const bindings = value.resources?.bindings
  if (!Array.isArray(bindings) || bindings.length !== 1 || bindings[0]?.name !== "ASSETS" || bindings[0]?.type !== "assets") throw Error("Static version binding mismatch")
}

/** Host-only API effects. Target/account are constants; credentials never enter returned data. */
export async function publishStaticAssets(journal: Journal, revision: string, token: () => string, transport: typeof fetch = fetch) {
  const source = await journal.get(revision), prepared = await prepareStaticAssets(revision, source.bytes, source.manifestDigest)
  const replay = await journal.begin(revision)
  if (replay) return { ...replay, historicalReplay: true }
  const request = api(token, transport), before = await latest(request)
  const module = staticAssetsModule(prepared), moduleDigest = await sha(module)
  await journal.intent(revision, "session")
  const session = (await request(`${script}/assets-upload-session`, "POST", JSON.stringify({ manifest: prepared.uploadManifest }))).value
  if (!jwt(session.jwt) || !Array.isArray(session.buckets) || session.buckets.length > 3) throw Error("Invalid static upload session")
  const seen = new Set<string>()
  for (const bucket of session.buckets) {
    if (!Array.isArray(bucket) || bucket.length === 0 || bucket.length > 3) throw Error("Invalid static upload bucket")
    for (const hash of bucket) {
      if (typeof hash !== "string" || seen.has(hash) || !prepared.assets.some(asset => asset.uploadHash === hash)) throw Error("Foreign or repeated static upload hash")
      seen.add(hash)
    }
  }
  await journal.acknowledge(revision, "session", await sha(session.jwt))
  let completion = session.buckets.length === 0 ? session.jwt : undefined
  for (const [index, bucket] of (session.buckets as string[][]).entries()) {
    const form = new FormData()
    for (const hash of bucket) {
      const asset = prepared.assets.find(asset => asset.uploadHash === hash)!
      form.set(hash, new Blob([asset.base64], { type: asset.contentType }), asset.path)
    }
    const step = `assets:${index}`
    await journal.intent(revision, step)
    const uploaded = await request(`${apiRoot}/assets/upload?base64=true`, "POST", form, session.jwt)
    if (index === session.buckets.length - 1) {
      if (uploaded.status !== 201 || !jwt(uploaded.value.jwt)) throw Error("Static upload completion acknowledgement missing")
      completion = uploaded.value.jwt
    }
    await journal.acknowledge(revision, step, await sha(JSON.stringify(bucket)))
  }
  if (!completion) throw Error("Static upload completion unavailable")
  const form = new FormData()
  form.set("metadata", new Blob([JSON.stringify({ main_module: "index.js", compatibility_date: "2026-10-07",
    bindings: [{ name: "ASSETS", type: "assets" }], assets: { jwt: completion, config: { html_handling: "none", run_worker_first: true } },
    annotations: { "workers/commit_sha": revision, "workers/repository_url": "https://github.com/ericclemmons/effect-ci-testbed", "workers/message": message(prepared, moduleDigest) } })], { type: "application/json" }), "metadata.json")
  form.set("index.js", new Blob([module], { type: "application/javascript+module" }), "index.js")
  await journal.intent(revision, "version")
  const version = (await request(`${script}/versions`, "POST", form)).value.id
  if (!uuid(version)) throw Error("Static version acknowledgement missing")
  await journal.acknowledge(revision, "version", version)
  await checkVersion(request, prepared, version, moduleDigest)
  if (JSON.stringify(await latest(request)) !== JSON.stringify(before)) throw Error("Static target deployment drift; no traffic write")
  const deploymentMessage = `effect-ci-static:${revision}:${prepared.assetDigest}`
  await journal.intent(revision, "deployment")
  const deployed = allocation((await request(`${script}/deployments`, "POST", JSON.stringify({ strategy: "percentage", versions: [{ version_id: version, percentage: 100 }], annotations: { "workers/message": deploymentMessage } }))).value, version)
  if (deployed.annotations?.["workers/message"] !== deploymentMessage) throw Error("Static deployment acknowledgement identity mismatch")
  await journal.acknowledge(revision, "deployment", deployed.id)
  return { revision, manifestDigest: prepared.manifestDigest, assetDigest: prepared.assetDigest, version, deployment: deployed.id, target: staticAssetsTarget, historicalReplay: false }
}

/** Separate read-only external proof, followed by local journal completion. Never retries a write. */
export async function verifyStaticAssets(journal: Journal, revision: string, token: () => string, transport: typeof fetch = fetch): Promise<StaticAssetReceipt> {
  const source = await journal.get(revision), prepared = await prepareStaticAssets(revision, source.bytes, source.manifestDigest)
  const record = await journal.inspect(revision)
  if (!record || record.pending || !uuid(record.steps.version) || !uuid(record.steps.deployment)) throw Error("Static publication requires reconciliation")
  const version = record.steps.version, deployment = record.steps.deployment, request = api(token, transport)
  await checkVersion(request, prepared, version, await sha(staticAssetsModule(prepared)))
  const current = allocation(await latest(request), version)
  if (current.id !== deployment || current.annotations?.["workers/message"] !== `effect-ci-static:${revision}:${prepared.assetDigest}`) throw Error("Static current deployment mismatch")
  for (const asset of prepared.assets) {
    const response = await transport(`${origin}/${asset.path}`, { redirect: "manual", signal: AbortSignal.timeout(10_000) })
    if (response.status !== 200 || response.redirected) { await response.body?.cancel(); throw Error("Static served asset unavailable") }
    if (response.headers.get("content-security-policy") !== staticAssetsCsp || response.headers.get("x-content-type-options") !== "nosniff") {
      await response.body?.cancel(); throw Error("Static serving policy mismatch")
    }
    const bytes = await bounded(response, 32 * 1024)
    if (bytes.length !== asset.size || await sha(bytes) !== asset.sha256) throw Error("Static served bytes mismatch")
  }
  const response = await transport(`${origin}/__proof`, { redirect: "manual", signal: AbortSignal.timeout(10_000) })
  if (response.status !== 200) { await response.body?.cancel(); throw Error("Static served identity unavailable") }
  const proof = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await bounded(response, 4096)))
  if (proof.revision !== revision || proof.assetDigest !== prepared.assetDigest || proof.manifestDigest !== prepared.manifestDigest) throw Error("Static served identity mismatch")
  return journal.complete(revision, version, deployment)
}

/** Recover ONLY a lost deployment ACK with a known unique version. No upload/deploy request. */
export async function reconcileStaticAssets(journal: Journal, revision: string, token: () => string, transport: typeof fetch = fetch) {
  const record = await journal.inspect(revision)
  if (record?.pending === "deployment" && uuid(record.steps.version)) {
    const source = await journal.get(revision), prepared = await prepareStaticAssets(revision, source.bytes, source.manifestDigest)
    const current = allocation(await latest(api(token, transport)), record.steps.version)
    if (current.annotations?.["workers/message"] !== `effect-ci-static:${revision}:${prepared.assetDigest}`) throw Error("Static reconciliation identity mismatch")
    await journal.acknowledge(revision, "deployment", current.id)
  }
  return verifyStaticAssets(journal, revision, token, transport)
}
