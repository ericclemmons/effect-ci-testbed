import { createRemoteJWKSet, decodeJwt, jwtVerify, SignJWT, type JWTVerifyGetKey } from "jose"
import { verifyIdentity } from "@effect-ci-testbed/cloudflare-oidc/auth"

const key = (secret: string) => {
  if (secret.length < 32) throw new Error("Hosted identity key missing")
  return new TextEncoder().encode(secret)
}

export const hostedIdentity = (claims: { repository_id: string; repository_owner_id: string; ref: string; revision: string }, origin: string, secret: string) =>
  new SignJWT({ ...claims, workflow_ref: `${origin}/hosted-ci`, event_name: "workflow_dispatch", run_id: crypto.randomUUID(), run_attempt: "1" })
    .setProtectedHeader({ alg: "HS256" }).setIssuer(`${origin}/oidc`).setAudience(origin)
    .setSubject(`repository:${claims.repository_id}`).setJti(crypto.randomUUID())
    .setIssuedAt().setNotBefore("0s").setExpirationTime("5m").sign(key(secret))

export const workloadIdentity = (secret: string) => async (token: string, audience: string) => {
  // The unverified issuer only selects a verifier; both paths verify signatures,
  // audience, expiry and required identity claims before authorizing anything.
  if (decodeJwt(token).iss !== `${audience}/oidc`) return verifyIdentity(token, audience)
  const { payload } = await jwtVerify(token, key(secret), {
    algorithms: ["HS256"], issuer: `${audience}/oidc`, audience, maxTokenAge: "5m",
    requiredClaims: ["exp", "iat", "nbf", "sub", "jti", "repository_id", "repository_owner_id", "ref", "workflow_ref", "run_id", "run_attempt"],
  })
  return payload
}

export const verifyAccess = async (token: string, issuer: string, audience: string, keys?: JWTVerifyGetKey) => {
  const url = new URL(issuer)
  if (url.protocol !== "https:" || !url.hostname.endsWith(".cloudflareaccess.com") || url.pathname !== "/") throw new Error("Invalid Access issuer")
  return jwtVerify(token, keys ?? createRemoteJWKSet(new URL("/cdn-cgi/access/certs", issuer)), {
    issuer: url.origin, audience, algorithms: ["RS256"], requiredClaims: ["exp", "iat", "sub"],
  })
}
