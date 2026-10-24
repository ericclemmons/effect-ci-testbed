import assert from "node:assert/strict"
import test from "node:test"
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose"
import { hostedIdentity, workloadIdentity, verifyAccess } from "./oidc-identity.ts"

test("hosted identities bind source repository and revision and reject forgery or another service", async () => {
  const secret = "s".repeat(64)
  const origin = "https://ci.example.com"
  const claims = { repository_id: "123", repository_owner_id: "456", ref: "refs/heads/main", revision: "f".repeat(40) }
  const token = await hostedIdentity(claims, origin, secret)
  const payload = await workloadIdentity(secret)(token, origin)
  for (const [key, value] of Object.entries(claims)) assert.equal(payload[key], value)
  assert.ok(payload.exp! - payload.iat! <= 300)
  await assert.rejects(workloadIdentity("x".repeat(64))(token, origin))
  await assert.rejects(workloadIdentity(secret)(token, "https://other.example.com"))
})

test("Access enrollment identity requires the configured audience, issuer and signature", async () => {
  const pair = await generateKeyPair("RS256")
  const keys = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: "access" }] })
  const issuer = "https://team.cloudflareaccess.com"
  const token = await new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "access" })
    .setIssuer(issuer).setAudience("service-aud").setSubject("operator").setIssuedAt().setExpirationTime("5m").sign(pair.privateKey)
  await verifyAccess(token, issuer, "service-aud", keys)
  await assert.rejects(verifyAccess(token, issuer, "other-aud", keys))
  await assert.rejects(verifyAccess(token, "https://other.cloudflareaccess.com", "service-aud", keys))
  await assert.rejects(verifyAccess(token, "https://untrusted.example", "service-aud", keys))
})
