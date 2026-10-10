const encoder = new TextEncoder()

const base64Url = (value: Uint8Array | string): string => {
  const bytes = typeof value === "string" ? encoder.encode(value) : value
  let binary = ""

  for (const byte of bytes) binary += String.fromCharCode(byte)

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
}

const decodePem = (pem: string): Uint8Array => {
  const encoded = pem
    .replaceAll("\\n", "\n")
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s/g, "")
  const binary = atob(encoded)

  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

const derLength = (length: number): Uint8Array => {
  if (length < 0x80) return Uint8Array.of(length)

  const bytes: Array<number> = []
  let remaining = length

  while (remaining > 0) {
    bytes.unshift(remaining & 0xff)
    remaining >>= 8
  }

  return Uint8Array.of(0x80 | bytes.length, ...bytes)
}

const der = (tag: number, value: Uint8Array): Uint8Array =>
  Uint8Array.of(tag, ...derLength(value.length), ...value)

const pkcs8 = (privateKey: string): Uint8Array => {
  const key = decodePem(privateKey)

  if (privateKey.includes("BEGIN PRIVATE KEY")) return key

  if (!privateKey.includes("BEGIN RSA PRIVATE KEY")) {
    throw new Error("Unsupported GitHub App private key format")
  }

  const version = Uint8Array.of(0x02, 0x01, 0x00)
  const rsaEncryption = Uint8Array.of(
    0x30, 0x0d,
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
    0x05, 0x00,
  )

  return der(0x30, Uint8Array.of(...version, ...rsaEncryption, ...der(0x04, key)))
}

export interface GitHubAppCredentials {
  readonly appId: string
  readonly privateKey: string
}

export const createAppJwt = async (
  credentials: GitHubAppCredentials,
  now = Math.floor(Date.now() / 1_000),
): Promise<string> => {
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const payload = base64Url(JSON.stringify({
    iat: now - 60,
    exp: now + 9 * 60,
    iss: credentials.appId,
  }))
  const input = `${header}.${payload}`
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8(credentials.privateKey).buffer as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(input),
  )

  return `${input}.${base64Url(new Uint8Array(signature))}`
}

export const createInstallationToken = async (
  credentials: GitHubAppCredentials,
  installationId: number,
): Promise<string> => {
  const jwt = await createAppJwt(credentials)
  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${jwt}`,
        "user-agent": "effect-ci-testbed",
        "x-github-api-version": "2026-03-10",
      },
    },
  )

  if (!response.ok) {
    throw new Error(`GitHub installation token failed (${response.status}): ${await response.text()}`)
  }

  const result = await response.json() as { readonly token: string }

  return result.token
}

const hex = (value: Uint8Array): string => [...value]
  .map((byte) => byte.toString(16).padStart(2, "0"))
  .join("")

const timingSafeEqual = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false

  let result = 0

  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }

  return result === 0
}

export const verifyWebhookSignature = async (
  secret: string,
  body: string,
  signature: string | null,
): Promise<boolean> => {
  if (!signature?.startsWith("sha256=")) return false

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(body))

  return timingSafeEqual(signature, `sha256=${hex(new Uint8Array(digest))}`)
}

export interface CheckSuiteWebhook {
  readonly action: "requested" | "rerequested"
  readonly check_suite: {
    readonly app: { readonly id: number }
    readonly head_branch: string | null
    readonly head_sha: string
  }
  readonly installation: {
    readonly id: number
  }
  readonly repository: {
    readonly clone_url: string
    readonly full_name: string
  }
}

export const parseCheckSuiteWebhook = (value: unknown): CheckSuiteWebhook | undefined => {
  if (!value || typeof value !== "object") return undefined

  const payload = value as Record<string, unknown>
  const suite = payload.check_suite as Record<string, unknown> | undefined
  const app = suite?.app as Record<string, unknown> | undefined
  const installation = payload.installation as Record<string, unknown> | undefined
  const repository = payload.repository as Record<string, unknown> | undefined

  if (
    (payload.action !== "requested" && payload.action !== "rerequested") ||
    (typeof suite?.head_branch !== "string" && suite?.head_branch !== null) ||
    typeof suite?.head_sha !== "string" ||
    !Number.isSafeInteger(app?.id) || Number(app?.id) <= 0 ||
    typeof installation?.id !== "number" ||
    typeof repository?.clone_url !== "string" ||
    typeof repository?.full_name !== "string"
  ) {
    return undefined
  }

  return value as CheckSuiteWebhook
}
