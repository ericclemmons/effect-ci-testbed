export interface GitHubWebhookEnvironment {
  readonly EFFECT_CI_APP_CLIENT_ID: string
  readonly EFFECT_CI_APP_PRIVATE_KEY: string
  readonly EFFECT_CI_WEBHOOK_SECRET: string
}

interface RequestedActionPayload {
  readonly action: string
  readonly requested_action?: {
    readonly identifier?: string
  }
  readonly check_run?: {
    readonly id?: number
    readonly name?: string
    readonly external_id?: string
  }
  readonly installation?: {
    readonly id?: number
  }
  readonly repository?: {
    readonly full_name?: string
  }
  readonly sender?: {
    readonly login?: string
  }
}

const encoder = new TextEncoder()

const bytesFromHex = (value: string): Uint8Array => {
  const bytes = new Uint8Array(value.length / 2)

  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16)
  }

  return bytes
}

const bytesFromBase64 = (value: string): Uint8Array =>
  Uint8Array.from(atob(value), (character) => character.charCodeAt(0))

const derLength = (length: number): Uint8Array => {
  if (length < 0x80) return Uint8Array.of(length)

  const bytes: Array<number> = []
  let remaining = length

  while (remaining > 0) {
    bytes.unshift(remaining & 0xff)
    remaining >>>= 8
  }

  return Uint8Array.of(0x80 | bytes.length, ...bytes)
}

const der = (tag: number, value: Uint8Array): Uint8Array => {
  const length = derLength(value.length)
  const encoded = new Uint8Array(1 + length.length + value.length)
  encoded[0] = tag
  encoded.set(length, 1)
  encoded.set(value, 1 + length.length)

  return encoded
}

const concat = (...values: ReadonlyArray<Uint8Array>): Uint8Array => {
  const result = new Uint8Array(values.reduce((length, value) => length + value.length, 0))
  let offset = 0

  for (const value of values) {
    result.set(value, offset)
    offset += value.length
  }

  return result
}

const pkcs8 = (privateKey: string): Uint8Array => {
  const normalized = privateKey.replaceAll("\\n", "\n")
  const pkcs1 = normalized.includes("BEGIN RSA PRIVATE KEY")
  const encoded = normalized
    .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/, "")
    .replace(/-----END (?:RSA )?PRIVATE KEY-----/, "")
    .replaceAll(/\s/g, "")
  const bytes = bytesFromBase64(encoded)

  if (!pkcs1) return bytes

  const version = Uint8Array.of(0x02, 0x01, 0x00)
  const rsaEncryption = Uint8Array.of(
    0x30, 0x0d,
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
    0x05, 0x00,
  )

  return der(0x30, concat(version, rsaEncryption, der(0x04, bytes)))
}

const toArrayBuffer = (value: Uint8Array): ArrayBuffer =>
  value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer

const base64Url = (value: string | ArrayBuffer): string => {
  const bytes = typeof value === "string"
    ? encoder.encode(value)
    : new Uint8Array(value)
  let binary = ""

  for (const byte of bytes) binary += String.fromCharCode(byte)

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "")
}

const verifySignature = async (
  body: string,
  signature: string | null,
  secret: string,
): Promise<boolean> => {
  if (!signature?.startsWith("sha256=")) return false

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  )

  return crypto.subtle.verify(
    "HMAC",
    key,
    toArrayBuffer(bytesFromHex(signature.slice("sha256=".length))),
    encoder.encode(body),
  )
}

const createAppJwt = async (
  clientId: string,
  privateKey: string,
): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    toArrayBuffer(pkcs8(privateKey)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const now = Math.floor(Date.now() / 1_000)
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const payload = base64Url(JSON.stringify({
    iat: now - 60,
    exp: now + 540,
    iss: clientId,
  }))
  const unsigned = `${header}.${payload}`
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(unsigned),
  )

  return `${unsigned}.${base64Url(signature)}`
}

const github = async (
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<Response> => fetch(`https://api.github.com${path}`, {
  ...init,
  headers: {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "user-agent": "effect-ci-testbed",
    "x-github-api-version": "2026-03-10",
    ...init.headers,
  },
})

const installationToken = async (
  environment: GitHubWebhookEnvironment,
  installationId: number,
): Promise<string> => {
  const jwt = await createAppJwt(
    environment.EFFECT_CI_APP_CLIENT_ID,
    environment.EFFECT_CI_APP_PRIVATE_KEY,
  )
  const response = await github(
    `/app/installations/${installationId}/access_tokens`,
    jwt,
    { method: "POST", body: "{}" },
  )

  if (!response.ok) {
    throw new Error(`Could not create installation token (${response.status})`)
  }

  const body = await response.json() as { readonly token: string }

  return body.token
}

const canApprove = async (
  token: string,
  repository: string,
  login: string,
): Promise<boolean> => {
  const response = await github(
    `/repos/${repository}/collaborators/${encodeURIComponent(login)}/permission`,
    token,
  )

  if (!response.ok) return false

  const body = await response.json() as { readonly permission?: string }

  return body.permission === "admin" || body.permission === "write"
}

export const handleGitHubWebhook = async (
  request: Request,
  environment: GitHubWebhookEnvironment,
): Promise<Response> => {
  if (request.method !== "POST") return new Response("Not found", { status: 404 })

  const body = await request.text()
  const valid = await verifySignature(
    body,
    request.headers.get("x-hub-signature-256"),
    environment.EFFECT_CI_WEBHOOK_SECRET,
  )

  if (!valid) return new Response("Invalid signature", { status: 401 })
  if (request.headers.get("x-github-event") !== "check_run") {
    return new Response("Ignored", { status: 202 })
  }

  const payload = JSON.parse(body) as RequestedActionPayload
  const identifier = payload.requested_action?.identifier
  const checkId = payload.check_run?.id
  const checkName = payload.check_run?.name
  const externalId = payload.check_run?.external_id
  const installationId = payload.installation?.id
  const repository = payload.repository?.full_name
  const actor = payload.sender?.login

  if (
    payload.action !== "requested_action" ||
    (identifier !== "approve" && identifier !== "reject") ||
    !checkId ||
    !checkName ||
    !externalId?.endsWith(":approve deployment") ||
    !installationId ||
    !repository ||
    !actor
  ) {
    return new Response("Ignored", { status: 202 })
  }

  const token = await installationToken(environment, installationId)

  if (!await canApprove(token, repository, actor)) {
    return new Response("Approver needs write access", { status: 403 })
  }

  const approved = identifier === "approve"
  const response = await github(
    `/repos/${repository}/check-runs/${checkId}`,
    token,
    {
      method: "PATCH",
      body: JSON.stringify({
        name: checkName,
        status: "completed",
        conclusion: approved ? "success" : "failure",
        output: {
          title: approved ? "Deployment approved" : "Deployment rejected",
          summary: `${approved ? "Approved" : "Rejected"} by @${actor}.`,
        },
        actions: [],
      }),
    },
  )

  if (!response.ok) {
    return new Response(`Could not update check (${response.status})`, { status: 502 })
  }

  return new Response("Accepted", { status: 202 })
}
