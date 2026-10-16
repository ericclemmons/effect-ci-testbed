import assert from "node:assert/strict"
import test from "node:test"
import { publishOwnedSlackCard, type OwnedCardReceipt, type OwnedCardStore } from "./owned-slack-card.ts"

const env = { SLACK_APP_ID: "APP", SLACK_TEAM_ID: "TEAM", SLACK_CHANNEL_ID: "CHANNEL", SLACK_BOT_TOKEN: "private-test-token" }
const frame = { text: "phase10", blocks: [{ type: "section", text: { type: "plain_text", text: "uncertain" } }] }
function fixture(failReceipt = false) {
  let receipt: OwnedCardReceipt | undefined
  const calls: Array<{ method: string; body: Record<string, unknown> }> = []
  const store: OwnedCardStore = {
    reserve: async (intent) => {
      if (receipt && (receipt.owner !== intent.owner || receipt.destination !== intent.destination ||
        receipt.stage !== "complete" || receipt.sequence >= intent.sequence)) return { acquired: false, receipt }
      if (receipt?.stage === "complete" && receipt.fingerprint === intent.fingerprint) {
        receipt = { ...receipt, sequence: intent.sequence }
        return { acquired: false, receipt }
      }
      const ts = receipt?.ts
      receipt = { ...intent, ...(ts ? { ts } : {}) }
      return { acquired: true, ...(ts ? { ts } : {}) }
    },
    complete: async (_intent, ts) => {
      if (failReceipt) throw new Error("Commit failed")
      receipt = { ...receipt!, stage: "complete", ts }
    },
  }
  const transport: typeof fetch = async (url, init) => {
    const request = new Request(url, init)
    assert.equal(request.redirect, "manual")
    assert.equal(request.headers.get("authorization"), `Bearer ${env.SLACK_BOT_TOKEN}`)
    const body = await request.json() as Record<string, unknown>
    calls.push({ method: String(url), body })
    return Response.json({ ok: true, channel: "CHANNEL", ts: "1791685465.683799" })
  }
  return { store, calls, transport, receipt: () => receipt }
}

test("one initial post then same-ts updates; replay, stale, conflicting and rotated identities never post", async () => {
  const f = fixture()
  const send = (sequence: number, content = frame) => publishOwnedSlackCard("run", sequence, content, env, f.store, f.transport)
  const results = await Promise.all([send(0), send(0)])
  assert.ok(results.some((result) => result.ok))
  assert.equal(f.calls.length, 1, "concurrent delivery may see pending or completed receipt but cannot post twice")
  assert.equal((await send(0)).ok, true)
  assert.equal((await send(1, { ...frame, text: "phase25" })).ok, true)
  assert.equal(f.calls.length, 2)
  assert.ok(f.calls[0]!.method.endsWith("chat.postMessage"))
  assert.ok(f.calls[1]!.method.endsWith("chat.update"))
  assert.equal(f.calls[1]!.body.ts, "1791685465.683799")
  assert.equal((await send(0)).ok, false)
  assert.equal((await send(1)).ok, false)
  assert.equal((await publishOwnedSlackCard("other", 2, frame, env, f.store, f.transport)).ok, false)
  assert.equal((await publishOwnedSlackCard("run", 2, frame, { ...env, SLACK_BOT_TOKEN: "rotated" }, f.store, f.transport)).ok, false)
  assert.equal(f.calls.length, 2)
  assert.equal(JSON.stringify(f.receipt()).includes(env.SLACK_BOT_TOKEN), false)
})

test("one maintained stage reply stays under its root, does not broadcast and replay cannot spam the thread", async () => {
  const f = fixture()
  const parent = "1791685465.111111"
  const send = (sequence: number, content = frame, root = parent) =>
    publishOwnedSlackCard("run", sequence, content, env, f.store, f.transport, undefined, root)
  assert.equal((await send(0)).ok, true)
  assert.equal(f.calls[0]!.body.thread_ts, parent)
  assert.equal(f.calls[0]!.body.reply_broadcast, false)
  assert.equal((await send(0)).ok, true)
  assert.equal(f.calls.length, 1)
  assert.equal((await send(1, { ...frame, text: "new evidence" })).ok, true)
  assert.ok(f.calls[1]!.method.endsWith("chat.update"))
  assert.equal(f.calls[1]!.body.ts, "1791685465.683799")
  assert.equal(f.calls[1]!.body.thread_ts, undefined)
  assert.equal((await send(2, frame, "1791685465.222222")).ok, false, "receipt cannot be moved to another root")
  assert.equal(f.calls.length, 2)
})

test("unchanged live frames advance their receipt without another API update", async () => {
  const f = fixture()
  assert.equal((await publishOwnedSlackCard("run", 0, frame, env, f.store, f.transport)).ok, true)
  assert.equal((await publishOwnedSlackCard("run", 1, frame, env, f.store, f.transport)).ok, true)
  assert.equal(f.receipt()?.sequence, 1)
  assert.equal(f.calls.length, 1)
})

test("a thread acknowledgement cannot identify its parent as the child message", async () => {
  const f = fixture()
  assert.equal((await publishOwnedSlackCard("run", 0, frame, env, f.store, f.transport, undefined, "1791685465.683799")).ok, false)
  assert.equal((await publishOwnedSlackCard("run", 0, frame, env, f.store, f.transport, undefined, "1791685465.683799")).ok, false)
  assert.equal(f.calls.length, 1, "ambiguous ack blocks a replacement post")
})

test("lost first-post acknowledgement or receipt commit blocks replay without another post", async () => {
  for (const failure of ["ack", "receipt", "redirect", "wrong-channel", "wrong-ts"] as const) {
    const f = fixture(failure === "receipt")
    const transport: typeof fetch = async (url, init) => {
      const response = await f.transport(url, init)
      if (failure === "ack") throw new Error("Accepted upstream, response lost")
      if (failure === "redirect") return new Response(null, { status: 307, headers: { location: "https://evil.invalid" } })
      if (failure === "wrong-channel") return Response.json({ ok: true, channel: "OTHER", ts: "1791685465.683799" })
      if (failure === "wrong-ts") return Response.json({ ok: true, channel: "CHANNEL", ts: "invalid" })
      return response
    }
    assert.equal((await publishOwnedSlackCard("run", 0, frame, env, f.store, transport)).ok, false)
    assert.equal((await publishOwnedSlackCard("run", 0, frame, env, f.store, transport)).ok, false)
    assert.equal((await publishOwnedSlackCard("run", 1, frame, env, f.store, transport)).ok, false)
    assert.equal(f.calls.length, 1, failure)
    assert.equal(f.receipt()?.stage, "pending")
  }
})

test("input is captured before awaits and oversized/invalid frames have no intent or request", async () => {
  const f = fixture()
  const mutable = structuredClone(frame)
  const sending = publishOwnedSlackCard("run", 0, mutable, env, f.store, f.transport)
  mutable.text = "changed"
  mutable.blocks[0]!.text.text = "changed"
  assert.equal((await sending).ok, true)
  assert.equal(f.calls[0]!.body.text, "phase10")
  assert.ok(JSON.stringify(f.calls[0]!.body.blocks).includes("uncertain"))
  const bad = fixture()
  assert.equal((await publishOwnedSlackCard("run", -1, frame, env, bad.store, bad.transport)).ok, false)
  assert.equal((await publishOwnedSlackCard("run", 0, { ...frame, text: "x".repeat(3001) }, env, bad.store, bad.transport)).ok, false)
  assert.equal(bad.receipt(), undefined)
  assert.equal(bad.calls.length, 0)
})

test("an update must acknowledge the same timestamp; ambiguous update never becomes another post", async () => {
  const f = fixture()
  assert.equal((await publishOwnedSlackCard("run", 0, frame, env, f.store, f.transport)).ok, true)
  const wrong: typeof fetch = async (url, init) => {
    await f.transport(url, init)
    return Response.json({ ok: true, channel: "CHANNEL", ts: "1791685465.999999" })
  }
  const changed = { ...frame, text: "phase25" }
  assert.equal((await publishOwnedSlackCard("run", 1, changed, env, f.store, wrong)).ok, false)
  assert.equal((await publishOwnedSlackCard("run", 1, changed, env, f.store, wrong)).ok, false)
  assert.equal((await publishOwnedSlackCard("run", 2, changed, env, f.store, wrong)).ok, false)
  assert.equal(f.calls.length, 2)
  assert.equal(f.receipt()?.ts, "1791685465.683799")
  assert.equal(f.receipt()?.stage, "pending")
  assert.ok(f.calls[1]!.method.endsWith("chat.update"))
})

test("private-image validation rejection permits only bounded same-frame update attempts", async () => {
  const f = fixture()
  await publishOwnedSlackCard("run", 0, frame, env, f.store, f.transport)
  const image = { ...frame, blocks: [...frame.blocks, { type: "image", slack_file: { id: "F123" }, alt_text: "Confidence" }] }
  let attempts = 0
  const waits: number[] = []
  const transport: typeof fetch = async (url, init) => {
    const response = await f.transport(url, init)
    attempts++
    return attempts < 3 ? Response.json({ ok: false, error: "invalid_blocks" }) : response
  }
  assert.equal((await publishOwnedSlackCard("run", 1, image, env, f.store, transport,
    async (ms) => { waits.push(ms) })).ok, true)
  assert.deepEqual(waits, [500, 1000])
  assert.equal(attempts, 3)
  assert.ok(f.calls.slice(1).every((call) => call.method.endsWith("chat.update") && call.body.ts === f.receipt()!.ts))
  assert.ok(f.calls.slice(1).every((call) => JSON.stringify(call.body) === JSON.stringify(f.calls[1]!.body)))
})

test("image rejection exhaustion and ambiguous second attempt never allocate a replacement message", async () => {
  for (const mode of ["exhausted", "ambiguous"] as const) {
    const f = fixture()
    await publishOwnedSlackCard("run", 0, frame, env, f.store, f.transport)
    const image = { ...frame, blocks: [...frame.blocks, { type: "image", slack_file: { id: "F123" }, alt_text: "Confidence" }] }
    let attempts = 0
    const transport: typeof fetch = async (url, init) => {
      await f.transport(url, init)
      attempts++
      if (mode === "ambiguous" && attempts === 2) throw new Error("Lost acknowledgement")
      return Response.json({ ok: false, error: "invalid_blocks" })
    }
    assert.equal((await publishOwnedSlackCard("run", 1, image, env, f.store, transport, async () => {})).ok, false)
    assert.equal(attempts, mode === "exhausted" ? 4 : 2)
    await publishOwnedSlackCard("run", 1, image, env, f.store, transport, async () => {})
    assert.equal(attempts, mode === "exhausted" ? 4 : 2, "pending intent blocks replay")
    assert.equal(f.receipt()!.stage, "pending")
  }
})

test("initial posts and non-validation failures are never retried, even with a private image", async () => {
  for (const mode of ["initial", "plain", "internal_error", "http", "malformed"] as const) {
    const f = fixture()
    if (mode !== "initial") await publishOwnedSlackCard("run", 0, frame, env, f.store, f.transport)
    const image = { ...frame, blocks: [...frame.blocks, { type: "image", slack_file: { id: "F123" }, alt_text: "Confidence" }] }
    let attempts = 0
    const transport: typeof fetch = async (url, init) => {
      await f.transport(url, init)
      attempts++
      if (mode === "http") return new Response("Unavailable", { status: 503 })
      if (mode === "malformed") return new Response("not JSON")
      return Response.json({ ok: false, error: mode === "internal_error" ? "internal_error" : "invalid_blocks",
        response_metadata: { messages: [env.SLACK_BOT_TOKEN] } })
    }
    const result = await publishOwnedSlackCard("run", mode === "initial" ? 0 : 1, mode === "plain" ? { ...frame, text: "phase25" } : image,
      env, f.store, transport, async () => { assert.fail("unexpected retry") })
    assert.equal(result.ok, false)
    assert.equal(attempts, 1)
    assert.equal(JSON.stringify(result).includes(env.SLACK_BOT_TOKEN), false)
  }
})

test("delivery availability, owned identity and authoritative state failures are distinct redacted outcomes", async () => {
  const result = async (mode: string) => {
    const f = fixture(mode === "receipt");
    const store = mode === "reserve" ? { ...f.store, reserve: async () => { throw Error(env.SLACK_BOT_TOKEN) } } : f.store;
    const transport: typeof fetch = async (url, init) => {
      await f.transport(url, init);
      if (mode === "throw") throw Error(env.SLACK_BOT_TOKEN);
      if (mode === "http") return new Response(env.SLACK_BOT_TOKEN, { status: 503 });
      if (mode === "rejection") return Response.json({ ok: false, error: env.SLACK_BOT_TOKEN });
      return Response.json({ ok: true, channel: mode === "identity" ? "OTHER" : "CHANNEL", ts: "1791685465.683799" });
    };
    const value = await publishOwnedSlackCard("run", 0, frame, env, store, transport);
    assert.equal(value.ok, false); assert.ok(!JSON.stringify(value).includes(env.SLACK_BOT_TOKEN));
    return value as { ok: false; failure: string };
  };
  for (const mode of ["throw", "http", "rejection"]) assert.equal((await result(mode)).failure, "delivery-unavailable", mode);
  for (const mode of ["reserve", "receipt"]) assert.equal((await result(mode)).failure, "state", mode);
  assert.equal((await result("identity")).failure, "identity");
});

test("same-owner ambiguous delivery stays held while foreign, stale and conflicting claims remain fatal identities", async () => {
  const f = fixture();
  const lost: typeof fetch = async (url, init) => { await f.transport(url, init); throw Error("Lost ACK") };
  const send = (owner: string, sequence: number, content = frame) => publishOwnedSlackCard(owner, sequence, content, env, f.store, lost);
  assert.equal((await send("run", 0) as any).failure, "delivery-unavailable");
  assert.equal((await send("run", 0) as any).failure, "delivery-pending");
  assert.equal((await send("run", 1, { ...frame, text: "new phase" }) as any).failure, "delivery-pending");
  assert.equal((await send("other", 1) as any).failure, "identity");
  assert.equal((await send("run", 0, { ...frame, text: "conflicting same sequence" }) as any).failure, "identity");
  assert.equal(f.calls.length, 1); assert.equal(f.receipt()?.stage, "pending");
});
