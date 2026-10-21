import assert from "node:assert/strict"
import test from "node:test"
import { worker, type WorkerEnvironment } from "./worker.ts"

test("remote goals require explicit host enrollment; malformed or unsupported selections never create a run", async () => {
  const created: any[] = []
  const environment = { EFFECT_CI_API_TOKEN: "fixture", GITHUB_APP_ID: "unused", GITHUB_PRIVATE_KEY: "unused", GITHUB_WEBHOOK_SECRET: "unused" } as WorkerEnvironment
  const workflow = () => ({ create: async (input: unknown) => { created.push(input) } }) as unknown as Workflow
  const application = worker({ routePrefix: "/demo", remoteTargets: ["test", "build"],
    remoteRunAllowed: input => input.repository === "https://github.com/owner/repo.git", workflow })
  const input = { repository: "https://github.com/owner/repo.git", revision: "a".repeat(40) }
  const dispatch = (body: unknown, app = application) => app.fetch(new Request("https://ci.invalid/demo/runs", {
    method: "POST", headers: { authorization: "Bearer fixture" }, body: JSON.stringify(body),
  }), environment)
  const capabilities = await application.fetch(new Request("https://ci.invalid/demo/capabilities", {
    headers: { authorization: "Bearer fixture" },
  }), environment)
  assert.equal(capabilities.status, 200)
  assert.deepEqual(await capabilities.json(), { protocol: "effect-ci-remote-v1", targets: ["test", "build"] })
  assert.equal((await application.fetch(new Request("https://ci.invalid/demo/capabilities"), environment)).status, 401)
  assert.equal(created.length, 0)
  const accessHost = worker({ routePrefix: "/demo", remoteTargets: ["test"],
    remoteAuthentication: ["api-token", "cloudflare-access-identity"], workflow })
  const advertised = await accessHost.fetch(new Request("https://ci.invalid/demo/capabilities", {
    headers: { authorization: "Bearer fixture" },
  }), environment)
  assert.deepEqual(await advertised.json(), { protocol: "effect-ci-remote-v1", targets: ["test"],
    authentication: ["api-token", "cloudflare-access-identity"] })
  assert.equal((await accessHost.fetch(new Request("https://ci.invalid/demo/capabilities", {
    headers: { "cf-access-jwt-assertion": "unverified" },
  }), environment)).status, 401, "advertising an auth method does not implement or grant it")
  assert.equal(created.length, 0)
  for (const selection of [{ targets: [] }, { targets: ["test", "test"] }, { targets: "test" },
    { targets: ["deploy"] }, { target: "build", targets: ["test"] }, { targets: ["test", 1] },
    { targets: Array.from({ length: 17 }, (_, i) => "goal" + i) }]) {
    assert.ok([400, 403].includes((await dispatch({ ...input, ...selection })).status))
    assert.equal(created.length, 0)
  }
  const legacy = worker({ routePrefix: "/demo", workflow })
  assert.equal((await dispatch({ ...input, targets: ["test"] }, legacy)).status, 403)
  assert.equal(created.length, 0)
  assert.equal((await dispatch({ ...input, targets: ["test", "build"] })).status, 202)
  assert.deepEqual(created[0].params, { trigger: "remote", ...input, targets: ["test", "build"] })
  assert.equal((await dispatch({ ...input, target: "build" })).status, 202)
  assert.equal(created[1].params.target, "build")
})

test("project-discovery hosts accept bounded goal names without bypassing authentication or admission", async () => {
  assert.throws(() => worker({ remoteTargetDiscovery: "project", remoteTargets: ["test"] }),
    /Choose fixed remote targets or project discovery/)
  const created: any[] = []
  const environment = { EFFECT_CI_API_TOKEN: "fixture" } as WorkerEnvironment
  const application = worker({ remoteTargetDiscovery: "project",
    remoteRunAllowed: input => input.repository === "https://github.com/owner/repo.git",
    workflow: () => ({ create: async (input: unknown) => { created.push(input) } }) as unknown as Workflow })
  const request = (path: string, body?: unknown, authenticated = true) => application.fetch(
    new Request("https://ci.invalid" + path, { ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
      headers: authenticated ? { authorization: "Bearer fixture" } : {} }), environment)
  const input = { repository: "https://github.com/owner/repo.git", revision: "a".repeat(40), targets: ["notes", "package:build"] }
  assert.equal((await request("/capabilities", undefined, false)).status, 401)
  assert.deepEqual(await (await request("/capabilities")).json(), {
    protocol: "effect-ci-remote-v1", targets: [], targetDiscovery: "project",
  })
  assert.equal((await request("/runs", input, false)).status, 401)
  assert.equal((await request("/runs", { ...input, repository: "https://github.com/other/repo.git" })).status, 403)
  for (const targets of [["--help"], ["notes;echo leak"], ["notes", "notes"], [], Array(17).fill("notes")]) {
    assert.equal((await request("/runs", { ...input, targets })).status, 400)
  }
  assert.equal(created.length, 0)
  assert.equal((await request("/runs", input)).status, 202)
  assert.deepEqual(created[0].params, { trigger: "remote", ...input })
})
