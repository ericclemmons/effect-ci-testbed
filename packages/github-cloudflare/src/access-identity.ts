import { createRemoteJWKSet, customFetch, decodeProtectedHeader, jwtVerify } from "jose"

/** Host enrollment only. Never derive issuer, audience or identity from a request. */
export interface AccessIdentityPolicy {
  readonly issuer: string
  readonly audience: string
  readonly subjectSha256: string
}

export function accessIdentityVerifier(policy: AccessIdentityPolicy, options: {
  readonly fetch?: typeof fetch
  readonly now?: () => Date
} = {}) {
  const enrolled = Object.freeze({ ...policy })
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(enrolled.issuer) ||
    !/^[a-f0-9]{64}$/.test(enrolled.audience) || !/^[a-f0-9]{64}$/.test(enrolled.subjectSha256))
    throw Error("Invalid Access identity enrollment")
  const certs = enrolled.issuer + "/cdn-cgi/access/certs"
  const keys = createRemoteJWKSet(new URL(certs), {
    timeoutDuration: 5000, cooldownDuration: 30_000, cacheMaxAge: 300_000,
    [customFetch]: async (url, init) => {
      if (url !== certs) throw Error("Invalid Access key origin")
      // Workers reject redirect:"error" before sending the request. Manual mode
      // never follows a key redirect; the exact 200 check below denies all 3xx.
      const response = await (options.fetch ?? fetch)(url, { ...init, credentials: "omit", redirect: "manual" })
      if (response.status !== 200 || !response.body) {
        await response.body?.cancel().catch(() => {})
        throw Error("Access keys unavailable")
      }
      const reader = response.body.getReader(), chunks: Uint8Array[] = []
      let length = 0
      try {
        for (;;) {
          const next = await reader.read()
          if (next.done) break
          length += next.value.byteLength
          if (length > 65_536) throw Error("Access keys exceed bound")
          chunks.push(next.value)
        }
      } finally { await reader.cancel().catch(() => {}) }
      const bytes = new Uint8Array(length)
      let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
      const jwks = JSON.parse(new TextDecoder().decode(bytes))
      if (!Array.isArray(jwks.keys) || !jwks.keys.length || jwks.keys.length > 16)
        throw Error("Invalid Access keys")
      // The library selects exactly one matching public signature key by kid.
      return Response.json({ keys: jwks.keys })
    },
  })
  return async (request: Request): Promise<boolean> => {
    const token = request.headers.get("cf-access-jwt-assertion")
    if (!token || token.length > 32_768 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) return false
    try {
      const header = decodeProtectedHeader(token)
      if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid || header.kid.length > 256 ||
        Object.keys(header).some(k => !["alg", "kid", "typ"].includes(k))) return false
      const now = options.now?.() ?? new Date()
      const { payload } = await jwtVerify(token, keys, {
        issuer: enrolled.issuer, audience: enrolled.audience, algorithms: ["RS256"],
        requiredClaims: ["iss", "aud", "sub", "iat", "exp"], currentDate: now,
      })
      if (payload.type !== "app" || payload.common_name !== undefined || typeof payload.sub !== "string" ||
        !payload.sub || payload.sub.length > 256 || !Number.isSafeInteger(payload.iat) ||
        payload.iat! > Math.floor(now.getTime() / 1000) || !Number.isSafeInteger(payload.exp)) return false
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload.sub))
      const subject = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("")
      return subject === enrolled.subjectSha256
    } catch { return false } // Never return a token, claim, key URL or verification exception.
  }
}
