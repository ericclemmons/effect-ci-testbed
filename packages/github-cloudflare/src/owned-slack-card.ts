import type { SlackBlock } from "./run-card.ts"

export interface OwnedCardReceipt {
  readonly owner: string
  readonly destination: string
  readonly fingerprint: string
  readonly sequence: number
  readonly stage: "pending" | "complete"
  readonly ts?: string
}
export interface OwnedCardStore {
  /** Atomic intent reservation. Pending deliveries must never be silently replaced. */
  reserve(intent: OwnedCardReceipt): Promise<{ acquired: true; ts?: string } | { acquired: false; receipt: OwnedCardReceipt }>
  complete(intent: OwnedCardReceipt, ts: string): Promise<void>
}
export interface OwnedCardEnvironment {
  readonly SLACK_APP_ID?: string
  readonly SLACK_TEAM_ID?: string
  readonly SLACK_CHANNEL_ID?: string
  readonly SLACK_BOT_TOKEN?: string
}
export interface OwnedCardFrame {
  readonly text: string
  readonly blocks: ReadonlyArray<SlackBlock>
}
export type OwnedCardFailure = "invalid-input" | "identity" | "state" | "delivery-unavailable" | "delivery-pending"
export type OwnedCardResult = { readonly ok: true; readonly ts: string } |
  { readonly ok: false; readonly failure: OwnedCardFailure; readonly error?: "invalid_blocks" | "slack-rejected" }
const failed = (failure: OwnedCardFailure): OwnedCardResult => ({ ok: false, failure })
const timestamp = /^\d{10,20}\.\d{6}$/
const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
  new TextEncoder().encode(value))), (byte) => byte.toString(16).padStart(2, "0")).join("")

export const ownedCardDestination = async (environment: OwnedCardEnvironment, parentTs?: string) =>
  digest(JSON.stringify([environment.SLACK_APP_ID, environment.SLACK_TEAM_ID, environment.SLACK_CHANNEL_ID,
    await digest(environment.SLACK_BOT_TOKEN ?? ""), ...(parentTs ? [parentTs] : [])]))

/** Host-only single-message delivery. Persist intent before POST, receipt before success.
 * Ambiguous post/update/receipt failures leave a pending intent, never trigger another
 * post, and require operator reconciliation. No exactly-once external API claim.
 */
export async function publishOwnedSlackCard(owner: string, sequence: number, frame: OwnedCardFrame,
  environment: OwnedCardEnvironment, store: OwnedCardStore, transport: typeof fetch = fetch,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  parentTs?: string,
): Promise<OwnedCardResult> {
  const { SLACK_APP_ID: app, SLACK_TEAM_ID: team, SLACK_CHANNEL_ID: channel, SLACK_BOT_TOKEN: token } = environment
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(owner) || !Number.isSafeInteger(sequence) || sequence < 0 ||
    !app || !team || !channel || !token || !frame || typeof frame.text !== "string" ||
    frame.text.length > 3000 || !Array.isArray(frame.blocks) || !frame.blocks.length || frame.blocks.length > 50 ||
    (parentTs !== undefined && !timestamp.test(parentTs))) return failed("invalid-input")
  let failure: OwnedCardFailure = "invalid-input"
  try {
    // Serialize before the first await. No mutable caller object reaches the transport.
    const content = JSON.stringify({ text: frame.text, blocks: frame.blocks })
    if (new TextEncoder().encode(content).length > 30_000) return failed("invalid-input")
    const destination = await ownedCardDestination(environment, parentTs)
    const intent: OwnedCardReceipt = { owner, sequence, destination, fingerprint: await digest(content), stage: "pending" }
    failure = "state"
    const reserved = await store.reserve(intent)
    if (!reserved.acquired) {
      const receipt = reserved.receipt
      if (receipt.owner !== owner || receipt.destination !== destination || !Number.isSafeInteger(receipt.sequence) || receipt.sequence < 0 ||
        !/^[a-f0-9]{64}$/.test(receipt.fingerprint) || (receipt.ts !== undefined && !timestamp.test(receipt.ts))) return failed("identity")
      if (receipt.stage === "pending" && receipt.sequence <= sequence &&
        (receipt.sequence !== sequence || receipt.fingerprint === intent.fingerprint)) return failed("delivery-pending")
      return receipt.sequence === sequence &&
        receipt.fingerprint === intent.fingerprint && receipt.stage === "complete" && receipt.ts && timestamp.test(receipt.ts)
        ? { ok: true, ts: receipt.ts } : failed("identity")
    }
    if (reserved.ts && !timestamp.test(reserved.ts)) return failed("identity")
    const request = {
      method: "POST", redirect: "manual", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ ...JSON.parse(content), channel,
        ...(reserved.ts ? { ts: reserved.ts } : parentTs ? { thread_ts: parentTs, reply_broadcast: false } : {}), parse: "none", unfurl_links: false, unfurl_media: false }),
    } as const
    const imageUpdate = Boolean(reserved.ts && (JSON.parse(content).blocks as SlackBlock[]).some((block) => block.type === "image" && block.slack_file))
    let result: { ok?: boolean; channel?: string; ts?: string; error?: string } = {}
    failure = "delivery-unavailable"
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await transport(`https://slack.com/api/${reserved.ts ? "chat.update" : "chat.postMessage"}`, {
        ...request, signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) { await response.body?.cancel(); return failed("delivery-unavailable") }
      result = await response.json()
      // A just-completed private file can fail Slack's block validation before it
      // becomes usable. Only a definite validation rejection of a KNOWN message
      // permits bounded retries of the identical frame. Lost ack, HTTP errors,
      // malformed replies, initial posts and all other errors stop immediately.
      if (result.ok === false && result.error === "invalid_blocks" && imageUpdate && attempt < 3) {
        await wait(500 * 2 ** attempt)
        continue
      }
      break
    }
    if (result.ok === false) return { ok: false, failure: "delivery-unavailable", error: result.error === "invalid_blocks" ? "invalid_blocks" : "slack-rejected" }
    if (result.ok !== true || result.channel !== channel || typeof result.ts !== "string" || !timestamp.test(result.ts) ||
      (parentTs && result.ts === parentTs) ||
      (reserved.ts && result.ts !== reserved.ts)) return failed("identity")
    failure = "state"
    await store.complete(intent, result.ts)
    return { ok: true, ts: result.ts }
  } catch { return failed(failure) }
}
