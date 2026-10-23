import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { appendFileSync, chmodSync, existsSync, readFileSync } from "node:fs"
import { createInterface } from "node:readline/promises"
import { parseArgs, parseEnv } from "node:util"

const { values } = parseArgs({ options: {
  account: { type: "string" },
  subdomain: { type: "string" },
} })
const path = ".env.production"
const settings = existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {}
const cli = process.env.CF_BIN ?? "cf"
const command = (args: string[]): any => {
  const result = spawnSync(cli, args, {
    encoding: "utf8",
    env: { ...process.env, ...settings },
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`cf ${args.join(" ")} failed: ${result.stderr}`)
  return JSON.parse(result.stdout)
}
const save = (entries: Record<string, string>) => {
  appendFileSync(path, "\n" + Object.entries(entries)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n") + "\n", { mode: 0o600 })
  chmodSync(path, 0o600)
  Object.assign(settings, entries)
}
const ask = async (question: string): Promise<string> => {
  if (!process.stdin.isTTY) throw new Error(`${question} Pass --account and --subdomain for non-interactive setup.`)
  const input = createInterface({ input: process.stdin, output: process.stdout })
  try { return (await input.question(question)).trim() }
  finally { input.close() }
}

const identity = command(["auth", "whoami"])
if (!identity.authenticated || !identity.email || !Array.isArray(identity.accounts)) {
  throw new Error("Run pnpm exec cf auth login with an identity that can read its email and accounts")
}
const accounts = identity.accounts as Array<{ id: string; name: string }>
let accountId = values.account ?? settings.CLOUDFLARE_ACCOUNT_ID
if (!accountId) {
  if (accounts.length === 1) accountId = accounts[0]!.id
  else {
    if (accounts.length === 0) throw new Error("No accessible Cloudflare accounts")
    accounts.forEach((account, index) => console.log(`${index + 1}. ${account.name} (${account.id})`))
    const selection = Number(await ask("Account number: "))
    accountId = accounts[selection - 1]?.id
  }
}
if (!accountId || !accounts.some((account) => account.id === accountId)) {
  throw new Error("Choose an account returned by cf auth whoami")
}
if (settings.CLOUDFLARE_ACCOUNT_ID && settings.CLOUDFLARE_ACCOUNT_ID !== accountId) {
  throw new Error("Existing .env.production belongs to another account; use a separate checkout")
}
if (values.subdomain || !settings.EFFECT_CI_PUBLIC_URL) {
  const subdomain = values.subdomain ?? await ask("Account's workers.dev subdomain (without .workers.dev): ")
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(subdomain)) throw new Error("Invalid workers.dev subdomain")
  save({ EFFECT_CI_PUBLIC_URL: `https://effect-ci-github-cloudflare.${subdomain}.workers.dev` })
}
save({
  CLOUDFLARE_ACCOUNT_ID: accountId,
  EFFECT_CI_ACCESS_REVIEWERS: settings.EFFECT_CI_ACCESS_REVIEWERS ?? identity.email,
  EFFECT_CI_STANDALONE: settings.EFFECT_CI_STANDALONE ?? "true",
  EFFECT_CI_API_TOKEN: settings.EFFECT_CI_API_TOKEN ?? Array.from(randomBytes(32), (byte) => byte.toString(16).padStart(2, "0")).join(""),
})
if (!settings.EFFECT_CI_ACCESS_SERVICE_TOKEN_ID || !settings.CF_ACCESS_CLIENT_ID || !settings.CF_ACCESS_CLIENT_SECRET) {
  const token = command(["zero-trust", "access", "service-tokens", "create", "--name", "Effect CI CLI"])
  if (![token.id, token.client_id, token.client_secret].every((value) => typeof value === "string" && value.length > 0)) {
    throw new Error("cf did not return complete Access service credentials")
  }
  save({
    EFFECT_CI_ACCESS_SERVICE_TOKEN_ID: token.id,
    CF_ACCESS_CLIENT_ID: token.client_id,
    CF_ACCESS_CLIENT_SECRET: token.client_secret,
  })
}
console.log(`Saved ${path} for ${settings.EFFECT_CI_PUBLIC_URL}. Run pnpm run deploy.`)
