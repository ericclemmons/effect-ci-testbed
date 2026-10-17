import assert from "node:assert/strict"
import test from "node:test"
import { slackPermalink } from "./notifications.ts"

test("step navigation uses Slack's actual workspace/thread permalink, with auth only on the fixed API", async () => {
  const permalink = "https://fixture.slack.com/archives/C123/p123000001?thread_ts=120.000001&cid=C123"
  const result = await slackPermalink("private-token", "C123", "123.000001", async (input, init) => {
    const url = new URL(String(input))
    assert.equal(url.origin + url.pathname, "https://slack.com/api/chat.getPermalink")
    assert.equal(url.searchParams.get("message_ts"), "123.000001")
    assert.equal(init?.redirect, "manual")
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer private-token")
    assert.ok(!url.href.includes("private-token"))
    return Response.json({ ok: true, channel: "C123", permalink })
  })
  assert.equal(result, permalink)
})

test("failed, oversized, foreign and mismatched permalink responses leave a plain step, with no retries", async () => {
  for (const response of [
    { ok: false }, { ok: true, channel: "COTHER", permalink: "https://fixture.slack.com/archives/C123/p123000001" },
    ...["https://evil.invalid/archives/C123/p123000001", "https://fixture.slack.com/archives/C123/p999",
      "https://user:secret@fixture.slack.com/archives/C123/p123000001", "javascript:alert(1)"].map(permalink => ({ ok: true, channel: "C123", permalink })),
  ]) {
    let calls = 0
    assert.equal(await slackPermalink("secret", "C123", "123.000001", async () => { calls++; return Response.json(response) }), null)
    assert.equal(calls, 1)
  }
  assert.equal(await slackPermalink("secret", "C123", "123.000001", async () => new Response("x".repeat(8193))), null)
  assert.equal(await slackPermalink("secret", "C123", "123.000001", async () => new Response(null, { status: 302, headers: { location: "https://evil.invalid" } })), null)
  assert.equal(await slackPermalink("secret", "invalid", "invalid", async () => { throw Error("must not fetch") }), null)
})
