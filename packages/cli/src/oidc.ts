import { workloadToken, hasWorkloadIdentity, workloadHeaders } from "./workload-auth.ts"
import { spawn, execFileSync } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { parseArgs } from "node:util"
import { remoteOrigin } from "./remote-protocol.ts"

interface Configuration { issuer: string; repository: string }

const repositoryName = (remote: string): string => {
  const match = remote.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/)
  if (!match) throw new Error("OIDC setup requires a GitHub remote.origin.url")
  return match[1]!
}

export const runOidc = async (args: string[], cwd: string, headers: Headers): Promise<void> => {
  const separator = args.indexOf("--")
  const command = separator < 0 ? [] : args.slice(separator + 1)
  const { values } = parseArgs({ args: separator < 0 ? args : args.slice(0, separator), options: {
    service: { type: "string" }, worker: { type: "string" }, scopes: { type: "string", default: "workers:edit" },
    help: { type: "boolean", short: "h" },
  } })
  if (values.help) {
    console.log("cf-ci oidc [--service https://your-ci-host]     Enable this repository through Access\ncf-ci oidc -- <deploy command>                 Deploy using temporary credentials")
    return
  }
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" }).trim()
  const path = join(root, ".cloudflare", "ci", "oidc.json")
  const saved = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as Configuration : undefined
  const configured = values.service ?? process.env.EFFECT_CI_REMOTE_URL ?? saved?.issuer
  if (!configured) throw new Error("Set EFFECT_CI_REMOTE_URL or use cf-ci oidc --service https://your-ci-host")
  const issuer = remoteOrigin(configured)
  if (new URL(issuer).pathname !== "/") throw new Error("OIDC service must be an HTTPS origin without a path")

  if (separator < 0) {
    const repository = repositoryName(execFileSync("git", ["config", "--get", "remote.origin.url"], { cwd: root, encoding: "utf8" }).trim())
    const workload = hasWorkloadIdentity()
    if (!workload && process.env.GITHUB_ACTIONS === "true") throw new Error("GitHub Actions OIDC requires permissions: id-token: write")
    if (!workload && !headers.has("cf-access-token") && !headers.has("cf-access-client-id")) {
      try {
        const token = execFileSync("cloudflared", ["access", "token", "--app", issuer], { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] }).trim()
        if (token) headers.set("cf-access-token", token)
      } catch { throw new Error("Sign into Cloudflare Access with cloudflared access login, or set CF_ACCESS_TOKEN / CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET") }
    }
    const response = await fetch(`${issuer}${workload ? "/api" : ""}/oidc/repositories`, {
      method: "POST", headers: workload ? await workloadHeaders(issuer) : headers, redirect: "manual", signal: AbortSignal.timeout(30_000), body: JSON.stringify({ repository }),
    })
    if (!response.ok) throw new Error(`Could not enable OIDC (${response.status}). Check Access, the GitHub App installation, and the hosted issuer configuration.`)
    const result = await response.json() as Configuration & { enabled?: boolean }
    if (result.enabled !== true || result.issuer !== issuer || result.repository.toLowerCase() !== repository.toLowerCase()) throw new Error("Invalid OIDC setup response")
    if (workload) {
      if (process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `EFFECT_CI_REMOTE_URL=${issuer}\n`)
      console.log(`OIDC enabled for ${result.repository}. The checkout was not modified.`)
      return
    }
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify({ issuer, repository: result.repository }, null, 2) + "\n")
    console.log(`OIDC enabled for ${result.repository}. Commit .cloudflare/ci/oidc.json, then use cf-ci oidc -- <deploy command>.`)
    return
  }
  if (!command.length) throw new Error("Provide a deploy command after --")
  if (new URL(issuer).protocol !== "https:") throw new Error("Workload credential exchange requires HTTPS")
  const identity = await workloadToken(issuer)
  const response = await fetch(`${issuer}/token`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
    headers: { authorization: `Bearer ${identity}`, "content-type": "application/json" },
    body: JSON.stringify({ worker: values.worker ?? "*", scopes: values.scopes!.split(/\s+/).filter(Boolean) }),
  })
  if (!response.ok) throw new Error(`OIDC exchange rejected (${response.status}); enable this repository with cf-ci oidc first`)
  const credential = await response.json() as { token: string; accountId: string; receipt: string }
  if (!credential.token || /[\r\n]/.test(credential.token) || !credential.receipt || /[\r\n]/.test(credential.receipt) || !/^[a-f0-9]{32}$/.test(credential.accountId)) {
    throw new Error("Invalid credential service response")
  }
  if (process.env.GITHUB_ACTIONS === "true") {
    for (const secret of [credential.token, credential.receipt]) console.log(`::add-mask::${secret.replaceAll("%", "%25")}`)
  }
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, CLOUDFLARE_API_TOKEN: credential.token, CLOUDFLARE_ACCOUNT_ID: credential.accountId }
    delete env.EFFECT_CI_OIDC_TOKEN
    process.exitCode = await new Promise<number>((resolve, reject) => {
      const child = spawn(command[0]!, command.slice(1), { cwd, env, stdio: "inherit" })
      child.on("error", reject)
      child.on("exit", (code) => resolve(code ?? 1))
    })
  } finally {
    const revoked = await fetch(`${issuer}/revoke`, { method: "POST", headers: { authorization: `Bearer ${credential.receipt}` }, redirect: "error", signal: AbortSignal.timeout(15_000) })
    if (!revoked.ok) throw new Error("Token revocation failed; the token will expire after 15 minutes")
  }
}
