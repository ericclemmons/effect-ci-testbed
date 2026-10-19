import assert from "node:assert/strict"
import test from "node:test"
import { updateVisibleCheck } from "./check-update.ts"
import { createCheck, updateCheck } from "./index.ts"

test("a newly created check becoming visible does not fail the workflow", async () => {
  const statuses = [404, 404, 200]
  const delays: number[] = []
  let requests = 0
  const response = await updateVisibleCheck(
    async () => { requests++; return new Response("{}", { status: statuses.shift()! }) },
    async (milliseconds) => { delays.push(milliseconds) },
  )
  assert.equal(response.status, 200)
  assert.equal(requests, 3)
  assert.deepEqual(delays, [250, 750])
})

test("persistent missing checks still fail after a bounded visibility window", async () => {
  let requests = 0
  const response = await updateVisibleCheck(
    async () => { requests++; return new Response("missing", { status: 404 }) },
    async () => {},
  )
  assert.equal(requests, 4)
  assert.equal(response.status, 404)
  assert.equal(await response.text(), "missing")
})

test("permission and validation failures are not hidden by retries", async () => {
  for (const status of [400, 401, 403, 409, 422, 429, 501]) {
    let requests = 0
    const response = await updateVisibleCheck(
      async () => { requests++; return new Response("denied", { status }) },
      async () => { assert.fail("must not retry this status") },
    )
    assert.equal(requests, 1)
    assert.equal(response.status, status)
  }
})

test("explicit transient server failures retry only the existing check update", async () => {
  for (const status of [500, 502, 503, 504]) {
    let requests = 0
    const delays: number[] = []
    const response = await updateVisibleCheck(
      async () => new Response("{}", { status: ++requests === 1 ? status : 200 }),
      async milliseconds => { delays.push(milliseconds) },
    )
    assert.equal(response.status, 200)
    assert.equal(requests, 2)
    assert.deepEqual(delays, [250])
  }
})

test("a persistent server error remains a failure after the bounded window", async () => {
  let requests = 0
  const delays: number[] = []
  const response = await updateVisibleCheck(
    async () => { requests++; return new Response("unavailable", { status: 500 }) },
    async milliseconds => { delays.push(milliseconds) },
  )
  assert.equal(requests, 4)
  assert.deepEqual(delays, [250, 750, 1500])
  assert.equal(response.status, 500)
  assert.equal(await response.text(), "unavailable")
})

test("transport exceptions are not replayed by the response retry helper", async () => {
  let requests = 0
  await assert.rejects(updateVisibleCheck(
    async () => { requests++; throw Error("lost response") },
    async () => { assert.fail("no response to classify") },
  ), /lost response/)
  assert.equal(requests, 1)
})

test("API retries the identical PATCH, never check creation", async () => {
  const original = globalThis.fetch
  const calls: Array<{url: string; method: string | undefined; body: BodyInit | null | undefined}> = []
  try {
    globalThis.fetch = async (url, options) => {
      calls.push({url:String(url),method:options?.method,body:options?.body})
      return new Response(JSON.stringify({id:42,html_url:"https://github.com/fixture/check/42"}), {status:calls.length===1?500:200})
    }
    await updateCheck({token:"fixture",repository:"owner/repo",checkId:42,title:"test",summary:"passed",conclusion:"success"})
    assert.equal(calls.length, 2)
    assert.deepEqual(calls[0], calls[1])
    assert.equal(calls[0].method, "PATCH")
    calls.length = 0
    await assert.rejects(createCheck({token:"fixture",repository:"owner/repo",sha:"a".repeat(40),name:"test",title:"test",summary:"queued"}), /failed \(500\)/)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].method, "POST")
  } finally { globalThis.fetch = original }
})
