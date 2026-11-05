// Local Cloudflare runtime for the same host that intercepts credential.ci.
export {
  CredentialVault,
  SecretOutbound,
  SecretOutboundWorkflow,
  SecretWorkspaceContainer,
} from "../../../test/apps/example-runner/src/secret-outbound.ts"

export default {
  fetch() {
    return new Response("Effect CI secret outbound example")
  },
}
