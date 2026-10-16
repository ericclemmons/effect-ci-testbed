import assert from "node:assert/strict"
import test from "node:test"
import { createHash } from "node:crypto"
import { generateKeyPair, exportJWK, SignJWT } from "jose"
import { accessIdentityVerifier } from "./access-identity.ts"

const issuer = "https://owned-fixture.cloudflareaccess.com", audience = "a".repeat(64), subject = "owned-human-identity"
const policy = { issuer, audience, subjectSha256: createHash("sha256").update(subject).digest("hex") }
const now = new Date("2026-10-16T21:00:00Z"), seconds = now.getTime() / 1000
const pair = await generateKeyPair("RS256"), foreign = await generateKeyPair("RS256")
const jwk = { ...await exportJWK(pair.publicKey), kid: "owned-key", alg: "RS256", use: "sig" }
const token = (patch = {}, header = {}, key = pair.privateKey) => new SignJWT({
  iss: issuer, aud: [audience], sub: subject, iat: seconds - 1, exp: seconds + 3600, type: "app", ...patch,
}).setProtectedHeader({ alg: "RS256", kid: "owned-key", ...header }).sign(key)
const request = (value: string) => new Request("https://host.invalid/demo/capabilities", { headers: { "cf-access-jwt-assertion": value } })
const fixture = (response: () => Response = () => Response.json({ keys: [jwk] })) => {
  const urls: string[] = []
  const verify = accessIdentityVerifier(policy, { now: () => now, fetch: async (url, init) => {
    urls.push(String(url)); assert.equal(String(url), issuer + "/cdn-cgi/access/certs")
    assert.equal(init?.redirect, "manual"); assert.equal(init?.credentials, "omit")
    assert.equal(new Headers(init?.headers).has("authorization"), false)
    assert.equal(new Headers(init?.headers).has("cf-access-jwt-assertion"), false)
    return response()
  } })
  return { verify, urls }
}

test("signature, exact enrolled identity, issuer, application and time are all required; keys are cached", async () => {
  const { verify, urls } = fixture()
  assert.equal(await verify(request(await token())), true)
  assert.equal(await verify(request(await token())), true)
  assert.equal(urls.length, 1)
  for (const patch of [{ iss: "https://attacker.invalid" }, { aud: ["b".repeat(64)] }, { sub: "another-human" },
    { exp: seconds }, { nbf: seconds + 1 }, { iat: seconds + 1 }, { type: "service" }, { common_name: "service-token" },
    { sub: "" }, { iat: undefined }, { exp: undefined }, { sub: undefined }])
    assert.equal(await verify(request(await token(patch))), false, JSON.stringify(patch))
  assert.equal(await verify(request(await token({}, {}, foreign.privateKey))), false)
  assert.equal(await verify(new Request("https://host.invalid/demo")), false)
  assert.equal(await verify(request("malformed")), false)
  assert.equal(await verify(request("x".repeat(32769))), false)
  assert.ok(urls.every(url => url === issuer + "/cdn-cgi/access/certs"))
})

test("JWT key URLs and unsupported algorithms never select a network destination", async () => {
  for (const header of [{ jku: "https://attacker.invalid/keys" }, { jwk }, { x5u: "https://attacker.invalid" },
    { crit: ["unexpected"] }, { kid: "foreign-key" }]) {
    const { verify, urls } = fixture()
    // Unsupported crit cannot be signed by JOSE; encode that header around a real signature.
    const signed = await token({}, "crit" in header ? {} : header)
    const altered = "crit" in header ? Buffer.from(JSON.stringify({ alg: "RS256", kid: "owned-key", ...header })).toString("base64url") + "." + signed.split(".").slice(1).join(".") : signed
    assert.equal(await verify(request(altered)), false)
    assert.ok(urls.every(url => url === issuer + "/cdn-cgi/access/certs"))
  }
  const { verify, urls } = fixture()
  const none = Buffer.from('{"alg":"none","kid":"owned-key"}').toString("base64url") + ".e30.fake"
  assert.equal(await verify(request(none)), false); assert.equal(urls.length, 0)
})

test("Workers key fetch uses manual redirect handling and refuses a redirected JWKS without following it", async () => {
  let requests = 0
  const verify = accessIdentityVerifier(policy, { now: () => now, fetch: async (url, init) => {
    requests++
    assert.equal(String(url), issuer + "/cdn-cgi/access/certs")
    // Actual workerd rejects `error` before network I/O, unlike Node fetch.
    assert.equal(init?.redirect, "manual")
    return new Response(null, { status: 302, headers: { location: "https://attacker.invalid/keys" } })
  } })
  assert.equal(await verify(request(await token())), false)
  assert.equal(requests, 1, "a key redirect must never cause a follow-up request")
})

test("key failures, redirects, ambiguous keys and oversized key bodies deny without leaking exceptions", async () => {
  for (const response of [() => new Response(null, { status: 302, headers: { location: "https://attacker.invalid" } }),
    () => Response.json({ keys: [jwk, jwk] }), () => new Response("not-json"),
    () => new Response("x".repeat(65537)), () => Response.json({ keys: [] }),
    () => Response.json({ keys: Array.from({ length: 17 }, () => jwk) })]) {
    const { verify } = fixture(response)
    assert.equal(await verify(request(await token())), false)
  }
  const verify = accessIdentityVerifier(policy, { now: () => now, fetch: async () => { throw Error("private provider diagnostic") } })
  assert.equal(await verify(request(await token())), false)
})

test("enrollment is host-owned, immutable and cannot point JWKS at arbitrary origins", async () => {
  for (const issuer of ["http://owned-fixture.cloudflareaccess.com", "https://owned-fixture.cloudflareaccess.com/", "https://attacker.invalid", "https://user:secret@owned-fixture.cloudflareaccess.com", "https://owned-fixture.cloudflareaccess.com?token=secret"])
    assert.throws(() => accessIdentityVerifier({ ...policy, issuer }), /enrollment/)
  assert.throws(() => accessIdentityVerifier({ ...policy, subjectSha256: "" }), /enrollment/)
  const mutable = { ...policy }, verify = accessIdentityVerifier(mutable, { now: () => now, fetch: async () => Response.json({ keys: [jwk] }) })
  mutable.subjectSha256 = "b".repeat(64)
  assert.equal(await verify(request(await token())), true)
})
