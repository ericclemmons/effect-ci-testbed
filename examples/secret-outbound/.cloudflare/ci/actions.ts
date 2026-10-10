import * as CI from "@effect-ci-testbed/ci"

const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source
  return () => source.checkout()
})

export const authenticate = CI.check("authenticated request", function* () {
  const workspace = yield* checkout()
  return function* () {
    yield* workspace.exec(`node -e 'if (Object.hasOwn(process.env, "PROBE_TOKEN")) throw Error("credential in environment"); const r = await fetch("http://credential.ci/verify", { headers: { authorization: "Bearer effect-ci-placeholder" } }); if (!r.ok || !(await r.json()).authenticated) throw Error("authentication failed"); console.log("host-authentication-verified")'`)
  }
})
