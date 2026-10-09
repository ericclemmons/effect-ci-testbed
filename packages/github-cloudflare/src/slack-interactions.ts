export interface SlackApprovalEnvironment {
  readonly SLACK_SIGNING_SECRET?: string
  readonly SLACK_APP_ID?: string
  readonly SLACK_TEAM_ID?: string
  readonly SLACK_CHANNEL_ID?: string
  /** Comma-separated Slack member IDs. Missing configuration denies approvals. */
  readonly SLACK_APPROVER_IDS?: string
}

export interface SlackDecision {
  readonly instanceId: string
  readonly requestId: string
  readonly token: string
  readonly decision: "approved" | "rejected"
  readonly actor: string
}

export const verifySlackSignature = async (secret: string, body: string, timestamp: string | null, signature: string | null, now = Date.now()): Promise<boolean> => {
  if (!timestamp || !/^\d+$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300 || !signature || !/^v0=[a-f0-9]{64}$/.test(signature)) return false
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"])
  const bytes = Uint8Array.from(signature.slice(3).match(/../g)!, (byte) => Number.parseInt(byte, 16))

  return crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(`v0:${timestamp}:${body}`))
}

/** Authenticate Slack independently of Access. Never follow payload response_url URLs. */
export const slackInteraction = async (
  request: Request,
  environment: SlackApprovalEnvironment,
  resolve: (decision: SlackDecision) => Promise<boolean>,
): Promise<Response> => {
  if (!environment.SLACK_SIGNING_SECRET || !environment.SLACK_APP_ID || !environment.SLACK_TEAM_ID || !environment.SLACK_CHANNEL_ID || !environment.SLACK_APPROVER_IDS) {
    return new Response("Slack approvals are not configured", { status: 503 })
  }
  const body = await request.text()
  if (!await verifySlackSignature(environment.SLACK_SIGNING_SECRET, body, request.headers.get("x-slack-request-timestamp"), request.headers.get("x-slack-signature"))) {
    return new Response("Invalid Slack signature", { status: 401 })
  }
  let payload
  try {
    payload = JSON.parse(new URLSearchParams(body).get("payload") ?? "null")
  } catch {
    return new Response("Invalid Slack payload", { status: 400 })
  }
  if (payload?.type !== "block_actions" || payload.api_app_id !== environment.SLACK_APP_ID || payload.team?.id !== environment.SLACK_TEAM_ID || payload.channel?.id !== environment.SLACK_CHANNEL_ID) {
    return new Response("Unexpected Slack context", { status: 403 })
  }
  const action = payload.actions?.length === 1 ? payload.actions[0] : undefined
  // Slack sends callbacks for URL buttons too; acknowledge navigation without mutation.
  if (action?.action_id === "view_workflow") return new Response(null, { status: 200 })
  const reviewers = environment.SLACK_APPROVER_IDS.split(",").map((id) => id.trim()).filter(Boolean)
  if (typeof payload.user?.id !== "string" || !reviewers.includes(payload.user.id)) {
    return Response.json({ response_type: "ephemeral", text: "You are not an authorized release reviewer." })
  }
  if (action?.action_id !== "approve_release" && action?.action_id !== "reject_release") return new Response("Unknown action", { status: 400 })
  let value
  try {
    value = JSON.parse(action.value)
  } catch {
    return new Response("Invalid approval", { status: 400 })
  }
  if (!value || typeof value.instanceId !== "string" || typeof value.requestId !== "string" || typeof value.token !== "string") return new Response("Invalid approval", { status: 400 })
  const accepted = await resolve({ ...value, decision: action.action_id === "approve_release" ? "approved" : "rejected", actor: `slack:${payload.team.id}:${payload.user.id}` })

  return Response.json({ response_type: "ephemeral", text: accepted ? "Decision submitted. This run’s checklist will update here." : "This approval is invalid or the run has already finished." })
}
