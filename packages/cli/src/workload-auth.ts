/** Obtain identity from the execution platform, never from project configuration. */
export const hasWorkloadIdentity = () => !!process.env.EFFECT_CI_OIDC_TOKEN ||
  !!(process.env.ACTIONS_ID_TOKEN_REQUEST_URL && process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)

export const workloadToken = async (service: string): Promise<string> => {
  const origin = new URL(service).origin
  if (process.env.EFFECT_CI_OIDC_TOKEN) return process.env.EFFECT_CI_OIDC_TOKEN
  if (!process.env.ACTIONS_ID_TOKEN_REQUEST_URL || !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    throw new Error("Run in the hosted cf-ci runner or GitHub Actions with permissions: id-token: write")
  }
  const url = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL)
  url.searchParams.set("audience", origin)
  const response = await fetch(url, { headers: { authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
    redirect: "error", signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error("GitHub OIDC identity request failed")
  const { value } = await response.json() as { value?: unknown }
  if (typeof value !== "string" || !value || /[\r\n]/.test(value)) throw new Error("Invalid workload identity")
  return value
}

export const workloadHeaders = async (service: string) => new Headers({
  "content-type": "application/json", authorization: `Bearer ${await workloadToken(service)}`,
})
