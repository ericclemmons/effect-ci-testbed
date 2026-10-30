import * as Effect from "effect/Effect"
import { createAppJwt } from "../../../packages/github/src/app.ts"
import { githubCommentProvider, renderGitHubComment } from "../../../packages/github-cloudflare/src/github-comment.ts"
import type { NotificationProvider, NotificationReceipt } from "../../../packages/github-cloudflare/src/notification-service.ts"
import type { RunSnapshot } from "../../../packages/github-cloudflare/src/run-card.ts"

export interface HmdGitHubTarget {
  readonly installationId: number
  readonly pullRequest: number
}
export interface HmdGitHubEnvironment {
  readonly GITHUB_APP_ID?: string
  readonly GITHUB_PRIVATE_KEY?: string
}
export interface HmdGitHubReceipt {
  readonly identity: string
  readonly sequence: number
  readonly fingerprint: string
  readonly pending: boolean
  readonly receipt?: NotificationReceipt
}
export interface HmdGitHubStore {
  get(provider: string): Promise<HmdGitHubReceipt | undefined>
  put(provider: string, receipt: HmdGitHubReceipt): Promise<void>
}

const positiveId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0
export const validHmdGitHubTarget = (target: HmdGitHubTarget): boolean =>
  !!target && positiveId(target.installationId) && positiveId(target.pullRequest)
const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest(
  "SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, "0")).join("")

async function request(path: string, token: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<any> {
  const response = await fetch(`https://api.github.com${path}`, {
    method, redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json",
      "content-type": "application/json", "user-agent": "effect-ci-testbed", "x-github-api-version": "2026-03-10" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!response.ok) { await response.body?.cancel(); throw new Error("HMD GitHub request failed") }
  const reader = response.body?.getReader()
  if (!reader) throw new Error("Missing HMD GitHub response")
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > 2 * 1024 * 1024) throw new Error("HMD GitHub response limit exceeded")
      chunks.push(chunk.value)
    }
  } finally { await reader.cancel() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return JSON.parse(new TextDecoder().decode(bytes))
}

async function providers(environment: HmdGitHubEnvironment, target: HmdGitHubTarget, run: RunSnapshot, signal: AbortSignal) {
  if (!environment.GITHUB_APP_ID || !environment.GITHUB_PRIVATE_KEY) throw new Error("HMD GitHub App is unavailable")
  const jwt = await createAppJwt({ appId: environment.GITHUB_APP_ID, privateKey: environment.GITHUB_PRIVATE_KEY })
  const app = await request("/app", jwt, "GET", undefined, signal)
  const installation = await request("/repos/ericclemmons/effect-ci-testbed/installation", jwt, "GET", undefined, signal)
  if (String(app.id) !== environment.GITHUB_APP_ID || !/^[a-z0-9-]{1,100}$/.test(app.slug) ||
    installation.id !== target.installationId || String(installation.app_id) !== environment.GITHUB_APP_ID)
    throw new Error("HMD GitHub App identity mismatch")
  const issued = await request(`/app/installations/${target.installationId}/access_tokens`, jwt, "POST", {
    repositories: ["effect-ci-testbed"], permissions: { contents: "read", checks: "write", pull_requests: "write" },
  }, signal)
  if (typeof issued.token !== "string" || !issued.token) throw new Error("HMD GitHub token unavailable")
  const token = issued.token
  const pull = await request(`/repos/ericclemmons/effect-ci-testbed/pulls/${target.pullRequest}`, token, "GET", undefined, signal)
  const bot = await request(`/users/${app.slug}%5Bbot%5D`, token, "GET", undefined, signal)
  if (pull.state !== "open" || pull.base?.repo?.full_name !== "ericclemmons/effect-ci-testbed" ||
    pull.head?.repo?.full_name !== "ericclemmons/effect-ci-testbed" || pull.head?.sha !== run.identity.revision ||
    !positiveId(bot.id) || bot.type !== "Bot" || bot.login !== `${app.slug}[bot]`)
    throw new Error("HMD GitHub fixture destination mismatch")
  return { token, botUserId: bot.id as number, appId: app.id as number }
}

function checkProvider(token: string, appId: number, identity: string, reconcileOnly: boolean, signal: AbortSignal): NotificationProvider {
  const api = (path: string, method = "GET", body?: unknown) => request(path, token, method, body, signal)
  return {
    id: "github-check",
    deliver: (run, previous) => Effect.tryPromise(async () => {
      const base = "/repos/ericclemmons/effect-ci-testbed"
      const externalId = `hmd:${identity}`
      const owned = (check: any) => positiveId(check?.id) && check.app?.id === appId &&
        check.head_sha === run.identity.revision && check.name === "Effect CI HMD" && check.external_id === externalId
      let check: any
      if (previous) {
        if (previous.identity !== identity || !/^[1-9][0-9]*$/.test(previous.checkId ?? "")) throw new Error("HMD check receipt mismatch")
        check = await api(`${base}/check-runs/${previous.checkId}`)
        if (!owned(check)) throw new Error("HMD check ownership mismatch")
      } else {
        const ids = new Set<number>()
        let total: number | undefined
        for (let page = 1; page <= 10; page++) {
          const history = await api(`${base}/commits/${run.identity.revision}/check-runs?filter=all&check_name=Effect%20CI%20HMD&per_page=100&page=${page}`)
          if (!Number.isSafeInteger(history.total_count) || history.total_count < 0 || history.total_count > 1000 ||
            (total !== undefined && total !== history.total_count) || !Array.isArray(history.check_runs) || history.check_runs.length > 100)
            throw new Error("HMD check history unavailable")
          total = Number(history.total_count)
          for (const item of history.check_runs) {
            if (!positiveId(item?.id) || ids.has(item.id)) throw new Error("HMD check history ambiguous")
            ids.add(item.id)
            if (owned(item)) {
              if (check) throw new Error("HMD check ownership ambiguous")
              check = item
            }
          }
          if (ids.size === total) break
          if (history.check_runs.length !== 100 || page === 10 || ids.size > total) throw new Error("HMD check history incomplete")
        }
      }
      if (!check && reconcileOnly) throw new Error("Unacknowledged HMD check requires reconciliation")
      const terminal = run.phase === "success" || run.phase === "failure"
      const result = await api(check ? `${base}/check-runs/${check.id}` : `${base}/check-runs`,
        check ? "PATCH" : "POST", {
          ...(!check ? { name: "Effect CI HMD", head_sha: run.identity.revision, external_id: externalId } : {}),
          status: terminal ? "completed" : "in_progress",
          ...(terminal ? { conclusion: run.phase === "failure" ? "failure" : "neutral" } : {}),
          details_url: run.identity.detailsUrl,
          output: { title: `HMD · ${run.phase}`, summary: renderGitHubComment(run) },
        })
      if (!owned(result) || (check && result.id !== check.id)) throw new Error("Invalid HMD check acknowledgement")
      return { identity, checkId: String(result.id) }
    }),
  }
}

export async function publishHmdGitHub(environment: HmdGitHubEnvironment, target: HmdGitHubTarget,
  run: RunSnapshot, sequence: number, store: HmdGitHubStore) {
  if (!validHmdGitHubTarget(target) || run.identity.repository !== "ericclemmons/effect-ci-testbed" ||
    !/^[a-f0-9]{40}$/.test(run.identity.revision) || !/^[A-Za-z0-9_-]{1,128}$/.test(run.identity.instanceId) ||
    !Number.isSafeInteger(sequence) || sequence < 0) throw new Error("Invalid HMD GitHub presentation")
  const identity = await digest(JSON.stringify([run.identity, target]))
  const fingerprint = await digest(JSON.stringify(run))
  const signal = AbortSignal.timeout(15_000)
  let auth: Awaited<ReturnType<typeof providers>>
  try { auth = await providers(environment, target, run, signal) }
  catch { return [{ provider: "github-check", status: "failed" }, { provider: "github-comment", status: "failed" }] }
  return Promise.all(["github-check", "github-comment"].map(async provider => {
    try {
      const previous = await store.get(provider)
      if (previous && (previous.identity !== identity || previous.sequence > sequence ||
        (previous.sequence === sequence && previous.fingerprint !== fingerprint))) throw new Error("Stale HMD GitHub presentation")
      if (previous && !previous.pending && previous.fingerprint === fingerprint) {
        await store.put(provider, { ...previous, sequence })
        return { provider, status: "delivered", sequence, receipt: previous.receipt }
      }
      await store.put(provider, { identity, sequence, fingerprint, pending: true, ...(previous?.receipt ? { receipt: previous.receipt } : {}) })
      const reconcileOnly = previous?.pending === true && !previous.receipt
      const destination = provider === "github-check" ? checkProvider(auth.token, auth.appId, identity, reconcileOnly, signal) :
        githubCommentProvider({ repository: "ericclemmons/effect-ci-testbed", pullRequest: target.pullRequest,
          botUserId: auth.botUserId, token: async () => auth.token, reconcileOnly,
          transport: (input, init) => fetch(input, { ...init,
            signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal }) })
      const receipt = await Effect.runPromise(destination.deliver(run, previous?.receipt))
      await store.put(provider, { identity, sequence, fingerprint, pending: false, receipt })
      return { provider, status: "delivered", sequence, receipt }
    } catch { return { provider, status: "failed", sequence } }
  }))
}
