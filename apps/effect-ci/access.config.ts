// Companion Access configuration until cf/config supports Access resources.
// These are Cloudflare Access application request bodies, not Worker bindings.
export const accessApplications = (options: {
  readonly hostname: string
  readonly reviewers: ReadonlyArray<string>
  readonly serviceTokenId?: string
  readonly slackCallbacks?: boolean
}) => {
  if (!options.hostname || options.hostname.includes(":") || options.hostname.includes("/")) {
    throw new Error("Access hostname must be a hostname without a scheme or path")
  }

  if (options.reviewers.length === 0) {
    throw new Error("Configure at least one Access reviewer")
  }

  return {
    service: {
      name: "Effect CI",
      type: "self_hosted",
      domain: options.hostname,
      session_duration: "24h",
      policies: [
        {
          name: "Release reviewers",
          decision: "allow",
          include: options.reviewers.map((email) => ({ email: { email } })),
        },
        ...(options.serviceTokenId ? [{
          name: "Effect CI CLI",
          decision: "non_identity",
          include: [{ service_token: { token_id: options.serviceTokenId } }],
        }] : []),
      ],
    },
    webhook: {
      name: "Effect CI GitHub webhook",
      type: "self_hosted",
      domain: `${options.hostname}/webhooks/github`,
      policies: [{
        name: "GitHub signature authentication",
        decision: "bypass",
        include: [{ everyone: {} }],
      }],
    },
    ...(options.slackCallbacks ? { slack: {
      name: "Effect CI Slack interactions",
      type: "self_hosted",
      domain: `${options.hostname}/webhooks/slack`,
      policies: [{ name: "Slack signature authentication", decision: "bypass", include: [{ everyone: {} }] }],
    } } : {}),
  }
}
