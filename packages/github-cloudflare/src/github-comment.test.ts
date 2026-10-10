import assert from "node:assert/strict"
import test from "node:test"
import * as Effect from "effect/Effect"
import { githubCommentProvider, renderGitHubComment } from "./github-comment.ts"
import { RunCard } from "./run-card.ts"

const card = (instanceId = "run-1") => new RunCard({ instanceId, repository: "owner/repo", revision: "abcdef1234567", detailsUrl: "https://example.com/details" })
const options = { repository: "owner/repo", pullRequest: 42, botUserId: 123, token: async () => "secret-token" }
const api = () => {
  const comments: any[] = []
  const calls: Array<{ path: string; method: string }> = []
  const transport = (async (input, init) => {
    const url = new URL(String(input))
    assert.equal(url.origin, "https://api.github.com")
    assert.equal(init?.redirect, "error")
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer secret-token")
    const method = init?.method ?? "GET"
    const path = url.pathname
    calls.push({ path, method })
    if (method === "GET" && path.endsWith("/42/comments")) return Response.json(comments)
    if (method === "POST") {
      const comment = { id: comments.length + 1, body: JSON.parse(String(init?.body)).body,
        user: { id: 123, type: "Bot" }, issue_url: "https://api.github.com/repos/owner/repo/issues/42" }
      comments.push(comment)
      return Response.json(comment, { status: 201 })
    }
    const comment = comments.find((item) => item.id === Number(path.split("/").at(-1)))
    if (method === "PATCH") comment.body = JSON.parse(String(init?.body)).body
    return comment ? Response.json(comment) : new Response(null, { status: 404 })
  }) as typeof fetch
  return { comments, calls, transport }
}

test("create and update one owned PR comment, link short revision and avoid redundant updates", async () => {
  const server = api()
  const provider = githubCommentProvider({ ...options, transport: server.transport })
  const run = card()
  const receipt = await Effect.runPromise(provider.deliver(run.snapshot(), undefined))
  run.update({ type: "step.status", workflowId: "build", stepId: "lint", status: "complete", optional: false, timestamp: "now" })
  assert.deepEqual(await Effect.runPromise(provider.deliver(run.snapshot(), receipt)), receipt)
  await Effect.runPromise(provider.deliver(run.snapshot(), receipt))
  assert.equal(server.comments.length, 1)
  assert.equal(server.calls.filter((call) => call.method === "POST").length, 1)
  assert.equal(server.calls.filter((call) => call.method === "PATCH").length, 1)
  assert.match(server.comments[0].body, /\[abcdef1\]/)
  assert.match(server.comments[0].body, /✅ lint/)
  assert.ok(!server.comments[0].body.includes("secret-token"))
})

test("lost receipt rediscovers the acknowledged post, and separate runs never overwrite it", async () => {
  const server = api()
  const provider = githubCommentProvider({ ...options, transport: server.transport })
  await Effect.runPromise(provider.deliver(card().snapshot(), undefined))
  await Effect.runPromise(provider.deliver(card().snapshot(), undefined))
  assert.equal(server.comments.length, 1)
  await Effect.runPromise(provider.deliver(card("run-2").snapshot(), undefined))
  assert.equal(server.comments.length, 2)
  assert.equal(server.calls.filter((call) => call.method === "PATCH").length, 0)
})

test("receipt ownership binds bot, PR and run; copied markers do not grant edit authority", async () => {
  for (const mutation of [
    (comment: any) => { comment.user.id = 999 },
    (comment: any) => { comment.user.type = "User" },
    (comment: any) => { comment.issue_url = "https://api.github.com/repos/owner/repo/issues/99" },
    (comment: any) => { comment.body = "not the owned marker" },
  ]) {
    const server = api()
    const provider = githubCommentProvider({ ...options, transport: server.transport })
    const receipt = await Effect.runPromise(provider.deliver(card().snapshot(), undefined))
    mutation(server.comments[0])
    await assert.rejects(Effect.runPromise(provider.deliver(card().snapshot(), receipt)), /GitHub comment notification failed/)
    assert.equal(server.calls.filter((call) => call.method === "PATCH").length, 0)
  }
})

test("ambiguous discovery and exhausted pagination never post a duplicate", async () => {
  const server = api()
  const provider = githubCommentProvider({ ...options, transport: server.transport })
  await Effect.runPromise(provider.deliver(card().snapshot(), undefined))
  server.comments.push({ ...server.comments[0], id: 2 })
  await assert.rejects(Effect.runPromise(provider.deliver(card().snapshot(), undefined)), /notification failed/)
  assert.equal(server.calls.filter((call) => call.method === "POST").length, 1)
  let pages = 0
  const bounded = githubCommentProvider({ ...options, transport: (async (_input, init) => {
    assert.equal(init?.method, "GET")
    pages++
    return Response.json(Array.from({ length: 100 }, (_, id) => ({ id: id + 1, body: "unrelated" })))
  }) as typeof fetch })
  await assert.rejects(Effect.runPromise(bounded.deliver(card().snapshot(), undefined)), /notification failed/)
  assert.equal(pages, 5)
})

test("API failures are redacted and create is not automatically retried", async () => {
  let calls = 0
  const provider = githubCommentProvider({ ...options, transport: (async () => {
    calls++
    return Response.json({ message: "secret-token" }, { status: 403 })
  }) as typeof fetch })
  await assert.rejects(Effect.runPromise(provider.deliver(card().snapshot(), undefined)), (error: Error) => {
    assert.ok(!String(error).includes("secret-token"))
    return true
  })
  assert.equal(calls, 1)
})

test("receipts cannot cross runs and oversized responses fail before posting", async () => {
  const server = api()
  const provider = githubCommentProvider({ ...options, transport: server.transport })
  const receipt = await Effect.runPromise(provider.deliver(card().snapshot(), undefined))
  const before = server.calls.length
  await assert.rejects(Effect.runPromise(provider.deliver(card("other-run").snapshot(), receipt)), /notification failed/)
  assert.equal(server.calls.length, before)
  let cancelled = false
  let calls = 0
  const bounded = githubCommentProvider({ ...options, transport: (async () => {
    calls++
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)) },
      cancel() { cancelled = true },
    }))
  }) as typeof fetch })
  await assert.rejects(Effect.runPromise(bounded.deliver(card().snapshot(), undefined)), /notification failed/)
  assert.equal(calls, 1)
  assert.equal(cancelled, true)
})

test("untrusted formatting cannot mention users or inject image/details links", () => {
  const run = card()
  run.update({ type: "step.status", workflowId: "@everyone", stepId: "![image](https://evil.test)\n@reviewer", status: "running", optional: false, timestamp: "now" })
  const body = renderGitHubComment({ ...run.snapshot(), identity: { ...run.snapshot().identity, detailsUrl: "javascript:alert(1)" } })
  assert.ok(!body.includes("@everyone"))
  assert.ok(!body.includes("@reviewer"))
  assert.ok(!body.includes("![image]("))
  assert.ok(!body.includes("javascript:"))
  assert.throws(() => githubCommentProvider({ ...options, repository: "owner/repo/../../private" }), /Invalid/)
})
