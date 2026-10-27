import * as CI from "@effect-ci-testbed/ci"

const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source
  return () => source.checkout()
})

export const authenticate = CI.check("authenticated request", function* () {
  const workspace = yield* checkout()
  return function* () {
    yield* workspace.exec(`node -e 'if (Object.hasOwn(process.env, "PROBE_TOKEN")) throw Error("credential in environment"); for (const [url, authorization] of [["http://credential.ci/verify", "Bearer wrong"], ["http://credential.ci/other", "Bearer effect-ci-placeholder"], ["http://credential.ci/verify?extra=1", "Bearer effect-ci-placeholder"]]) { const denied = await fetch(url, { headers: { authorization } }); if (denied.status !== 403) throw Error("capability not scoped"); } const r = await fetch("http://credential.ci/verify", { headers: { authorization: "Bearer effect-ci-placeholder" } }); if (!r.ok || r.headers.has("x-reflected-credential") || JSON.stringify(await r.json()) !== JSON.stringify({ authenticated: true })) throw Error("authentication failed"); console.log("host-authentication-verified")'`)
  }
})
