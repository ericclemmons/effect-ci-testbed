import assert from "node:assert/strict"
import { realpath } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"

const require = createRequire(import.meta.url)
const pluginPath = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url))
const { build } = require(require.resolve("esbuild", { paths: [pluginPath] }))
// Execute the actual checkout class against a VM command recorder. Only the
// platform base classes are mocked; Git checkout and proxy policy are production.
const output = await build({ entryPoints: [new URL("../../../packages/cloudflare/src/index.ts", import.meta.url).pathname], bundle: true, write: false, format: "esm", platform: "node", target: "esnext", plugins: [{ name: "platform-base", setup(builder: any) {
  builder.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: "platform", namespace: "mock" }))
  builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: "export class DurableObject {constructor(ctx,env){this.ctx=ctx;this.env=env}}; export class WorkerEntrypoint extends DurableObject {}; export class WorkflowEntrypoint extends DurableObject {};" }))
} }] })
const { WorkspaceContainer } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`)

test("actual authenticated checkout never passes a credential to VM commands and revokes before project checkout", async () => {
  const token = "private-installation-canary"
  const commands: string[][] = []
  const props: { capability: string; workspaceId: string }[] = []
  const storageWrites: unknown[] = []
  let origin = ""
  let fail = false
  let workspace: any
  const request = () => new Request("http://github-checkout.ci/owner/private.git/info/refs?service=git-upload-pack")
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (incoming: RequestInfo | URL) => {
    assert.equal((incoming as Request).headers.get("authorization"), `Basic ${btoa(`x-access-token:${token}`)}`)
    return new Response("pack", { headers: { "content-type": "application/x-git-upload-pack-advertisement" } })
  }
  const container = {
    running: true,
    async interceptOutboundHttp(host: string, binding: object) { assert.equal(host, "github-checkout.ci"); assert.ok(binding) },
    async exec(command: string[], environment: unknown) {
      commands.push(command)
      assert.equal(environment, undefined, "no credentials in process environment")
      assert.ok(!JSON.stringify(command).includes(token))
      assert.ok(!JSON.stringify(command).includes(btoa(`x-access-token:${token}`)))
      let exitCode = command[0] === "test" ? 1 : 0
      if (command.includes("clone") || command.includes("fetch")) {
        assert.equal((await workspace.gitCheckoutFetch(request(), props.at(-1)!.capability)).status, 200)
        if (fail) exitCode = 1
      }
      if (command.includes("set-url")) origin = command.at(-1)!
      if (command.includes("checkout")) assert.equal((await workspace.gitCheckoutFetch(request(), props.at(-1)!.capability)).status, 403)
      return { async output() { return { exitCode, stdout: new Uint8Array(), stderr: new TextEncoder().encode(exitCode ? token : "") } } }
    },
  }
  workspace = new WorkspaceContainer({ container, id: { toString: () => "workspace-id" }, storage: { put(key: string, value: unknown) {
    assert.equal(key, "workingMutation", "checkout may persist only its credential-free mutation marker")
    assert.deepEqual(value, { stepId: undefined, revisionId: undefined }, "no token, host capability or extra field may be persisted")
    storageWrites.push({ key, value })
  } }, exports: {
    GitCheckoutOutbound({ props: value }: { props: { capability: string; workspaceId: string } }) { props.push(value); assert.ok(!JSON.stringify(value).includes(token)); return {} },
  } }, {})
  try {
    await workspace.checkout("https://github.com/owner/private.git", "a".repeat(40), undefined, {}, token)
    assert.equal(origin, "https://github.com/owner/private.git", "Git config keeps canonical token-free origin")
    assert.equal((await workspace.gitCheckoutFetch(request(), props[0]!.capability)).status, 403)
    await workspace.checkout("https://github.com/owner/private.git", "b".repeat(40), undefined, {}, token, ["cache"])
    assert.notEqual(props[0]!.capability, props[1]!.capability, "cache checkout creates a fresh host capability")
    fail = true
    await assert.rejects(workspace.checkout("https://github.com/owner/private.git", "c".repeat(40), undefined, {}, token), /^Error: Authenticated git clone failed$/)
    assert.equal((await workspace.gitCheckoutFetch(request(), props.at(-1)!.capability)).status, 403, "failure also revokes")
    assert.ok(commands.some(command => command.includes("http://github-checkout.ci/owner/private.git")))
    assert.equal(storageWrites.length, 3)
    assert.ok(!JSON.stringify(storageWrites).includes(token))
    assert.ok(!JSON.stringify(storageWrites).includes(btoa(`x-access-token:${token}`)))
  } finally { globalThis.fetch = originalFetch }
})
