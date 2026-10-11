import { verifySlackSignature, type SlackApprovalEnvironment } from "../../../packages/github-cloudflare/src/slack-interactions.ts"
import type { HmdCapability } from "./hmd-approval.ts"

interface Reviews {
  inspect(capability: HmdCapability): Promise<boolean>
  submit(capability: HmdCapability, decision: "approved" | "rejected", reason: string, actor: string): Promise<boolean>
}
type Environment = SlackApprovalEnvironment & { SLACK_BOT_TOKEN?: string; HMD_REQUIRE_RATIONALE?: string }
/** Classification is not authentication. Both callback handlers independently verify HMAC. */
export function isHmdSlackBody(body: string): boolean {
  try {
    const p = JSON.parse(new URLSearchParams(body).get("payload") ?? "null")
    return p?.view?.callback_id === "hmd_review" || p?.actions?.some((a: { action_id?: string }) => ["hmd_approve", "hmd_reject"].includes(a.action_id ?? "")) === true
  } catch { return false }
}
export async function hmdSlackInteraction(request: Request, env: Environment, reviews: Reviews, transport: typeof fetch = fetch): Promise<Response> {
  if (!env.SLACK_SIGNING_SECRET || !env.SLACK_APP_ID || !env.SLACK_TEAM_ID || !env.SLACK_CHANNEL_ID || !env.SLACK_APPROVER_IDS || !env.SLACK_BOT_TOKEN) return new Response("Not configured", { status: 503 })
  const body = await request.text()
  if (body.length > 32_000 || !await verifySlackSignature(env.SLACK_SIGNING_SECRET, body, request.headers.get("x-slack-request-timestamp"), request.headers.get("x-slack-signature"))) return new Response("Invalid signature", { status: 401 })
  let p
  try { p = JSON.parse(new URLSearchParams(body).get("payload") ?? "null") } catch { return new Response("Invalid payload", { status: 400 }) }
  if (p?.api_app_id !== env.SLACK_APP_ID || p.team?.id !== env.SLACK_TEAM_ID ||
    !env.SLACK_APPROVER_IDS.split(",").map((id) => id.trim()).includes(p.user?.id)) return new Response("Unauthorized reviewer", { status: 403 })
  const actor = `slack:${p.team.id}:${p.user.id}`
  try {
    if (p.type === "block_actions") {
      const action = p.actions?.length === 1 ? p.actions[0] : undefined
      if (p.channel?.id !== env.SLACK_CHANNEL_ID || !["hmd_approve", "hmd_reject"].includes(action?.action_id) ||
        typeof p.trigger_id !== "string" || p.trigger_id.length > 256) return new Response("Invalid context", { status: 403 })
      const capability = JSON.parse(action.value) as HmdCapability
      if (!await reviews.inspect(capability)) return Response.json({ response_type: "ephemeral", text: "This phase is no longer awaiting review." })
      const decision = action.action_id === "hmd_approve" ? "approved" : "rejected"
      if (env.HMD_REQUIRE_RATIONALE !== "true") {
        const accepted = await reviews.submit(capability, decision,
          decision === "approved" ? "Progress requested directly in Slack (explicit risk acceptance)" : "Rejected directly in Slack", actor)
        return Response.json({ response_type: "ephemeral", text: accepted
          ? "Decision recorded. The release card will update when the Workflow resumes."
          : "This review expired, was consumed, or lost release ownership. No decision was resent." })
      }
      const response = await transport("https://slack.com/api/views.open", {
        method: "POST", redirect: "manual", signal: AbortSignal.timeout(2000),
        headers: { authorization: `Bearer ${env.SLACK_BOT_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ trigger_id: p.trigger_id, view: { type: "modal", callback_id: "hmd_review",
          title: { type: "plain_text", text: "Review release risk" }, submit: { type: "plain_text", text: decision === "approved" ? "Accept risk" : "Reject" },
          close: { type: "plain_text", text: "Cancel" }, private_metadata: JSON.stringify({ capability, decision, actor }),
          blocks: [ { type: "section", text: { type: "plain_text", text: `Phase ${capability.phase}%. Approval accepts this snapshot's risk; it does not make uncertain data healthy.` } },
            { type: "input", block_id: "rationale", label: { type: "plain_text", text: "Rationale" }, element: { type: "plain_text_input", action_id: "reason", multiline: true, max_length: 500 } } ],
        } }),
      })
      if (!response.ok || (await response.json() as { ok?: boolean }).ok !== true) return new Response("Unable to open review", { status: 502 })
      return new Response(null, { status: 200 })
    }
    if (p.type !== "view_submission" || p.view?.callback_id !== "hmd_review") return new Response("Unknown interaction", { status: 400 })
    const meta = JSON.parse(p.view.private_metadata)
    if (meta.actor !== actor || !["approved", "rejected"].includes(meta.decision)) return new Response("Invalid reviewer context", { status: 403 })
    const reason = p.view.state?.values?.rationale?.reason?.value
    if (typeof reason !== "string" || !reason.trim() || reason.length > 500) return Response.json({ response_action: "errors", errors: { rationale: "Provide a rationale (1–500 characters)." } })
    const accepted = await reviews.submit(meta.capability, meta.decision, reason, actor)
    return accepted ? new Response(null, { status: 200 }) : Response.json({ response_action: "errors", errors: { rationale: "This review expired, was consumed, or lost release ownership. No decision was resent." } })
  } catch { return new Response("Review failed closed", { status: 400 }) }
}
