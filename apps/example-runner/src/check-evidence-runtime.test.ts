import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { realpath } from "node:fs/promises"
import test from "node:test"
import { hostedCheckBytes, type HostedCheckIdentity } from "../../../packages/cloudflare/src/check-evidence.ts"

const require = createRequire(import.meta.url)
const pluginPath = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url))
const { Miniflare } = require(require.resolve("miniflare", { paths: [pluginPath] }))
const { build } = require(require.resolve("esbuild", { paths: [pluginPath] }))

test("actual workerd verifies host-pinned inputs with only a public key", { timeout: 30_000 }, async () => {
  const identity: HostedCheckIdentity = {
    kind: "check", repository: "https://github.com/example/fixture", revision: "a".repeat(40),
    workflowId: "fixture", stepId: "lint", command: "node --check app/index.js",
    policyDigest: "b".repeat(64), toolchainDigest: "c".repeat(64), sourceDigest: "d".repeat(64),
  }
  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]) as CryptoKeyPair
  // Raw public bytes avoid Node/workerd JWK alg-label differences.
  const publicKey = Array.from(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)))
  const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", pair.privateKey, hostedCheckBytes(identity)))
  const note = { version: 1, keyId: "lab-only", identity,
    signature: btoa(String.fromCharCode(...signature)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_") }
  const output = await build({ stdin: { contents: `
    import {verifyHostedCheckEvidence} from '../../../packages/cloudflare/src/check-evidence.ts';
    export default {async fetch(request,env){
      const input=await request.json();
      let publicKey;
      try {publicKey=await crypto.subtle.importKey('raw',Uint8Array.from(env.PUBLIC_KEY),'Ed25519',false,['verify']);}
      catch(error){return Response.json({error:error.message},{status:500});}
      const accepted=await verifyHostedCheckEvidence(input.note,env.EXPECTED,new Map([['lab-only',publicKey]]));
      return Response.json({accepted,bindings:Object.keys(env).sort()});
    }};
  `, resolveDir: new URL(".", import.meta.url).pathname, loader: "ts", sourcefile: "evidence-probe.ts" },
    bundle: true, write: false, format: "esm", target: "esnext" })
  const runtime = new Miniflare({ workers: [{ config: {
    name: "evidence-probe", compatibilityDate: "2026-10-07",
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: output.outputFiles[0].text } } },
    env: { EXPECTED: { type: "json", value: identity }, PUBLIC_KEY: { type: "json", value: publicKey } },
  } }] })
  try {
    const send = async (value: object) => {
      const response = await runtime.dispatchFetch("https://probe.invalid", { method: "POST", body: JSON.stringify(value) })
      const body = await response.json()
      assert.equal(response.status, 200, JSON.stringify(body))
      return body
    }
    assert.deepEqual(await send({ note: JSON.stringify(note) }), { accepted: true, bindings: ["EXPECTED", "PUBLIC_KEY"] })
    for (const value of [undefined, "not json", JSON.stringify({ ...note, keyId: "unknown" }),
      JSON.stringify({ ...note, identity: { ...identity, revision: "e".repeat(40) } }),
      JSON.stringify({ ...note, identity: { ...identity, sourceDigest: "e".repeat(64) } }),
    ]) assert.equal((await send({ note: value, expected: note.identity })).accepted, false)
  } finally {
    await runtime.dispose()
  }
})
