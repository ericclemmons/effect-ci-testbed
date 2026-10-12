/** Fixed host-generated error vocabulary only; raw exceptions never enter notifications. */
export function hmdFailureReason(error: unknown): string {
  let message: unknown
  try { message = Object.getOwnPropertyDescriptor(error, "message")?.value } catch { /* opaque error */ }
  if (typeof message !== "string") return "Release operation failed; see Details."
  const api = message.match(/^Release API request failed \((credential|timeout|transport|response)(?:, HTTP (\d{3}))?\)$/)
  if (api) return api[1] === "transport" ? "Release API request failed (transport): could not connect to Cloudflare." :
    `Release API request failed (${api[1]}${api[2] ? `, HTTP ${api[2]}` : ""}).`
  const known = ["Deployment ownership drift; refusing overwrite", "Deployment ownership drift",
    "Ambiguous deployment acknowledgement; reconcile required", "Unresolved deployment intent; operator review required",
    "Release controller lease expired", "Release ownership mismatch", "Release phase must advance in order",
    "Invalid native outcome attribution", "Native health query failed; no HTTP fallback",
    "Progression deadline cannot accept this stage", "Unexpected review-lab baseline",
    "Previous native cohort incomplete; no promotion", "Invalid baseline receipts", "Invalid candidate receipts",
    "Conclusive regression; approval is prohibited", "HMD sampling window exhausted", "Human rejected the release",
    "Health review expired", "Invalid health review response", "Invalid or stale health review response",
    "Release is terminal", "Release cannot renew"]
  return known.includes(message) ? message : "Release operation failed; see Details."
}
