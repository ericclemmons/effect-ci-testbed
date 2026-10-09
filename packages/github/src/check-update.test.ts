import assert from "node:assert/strict"
import test from "node:test"
import { updateVisibleCheck } from "./check-update.ts"

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
  for (const status of [401, 403, 422]) {
    let requests = 0
    const response = await updateVisibleCheck(
      async () => { requests++; return new Response("denied", { status }) },
      async () => { assert.fail("must not retry this status") },
    )
    assert.equal(requests, 1)
    assert.equal(response.status, status)
  }
})
