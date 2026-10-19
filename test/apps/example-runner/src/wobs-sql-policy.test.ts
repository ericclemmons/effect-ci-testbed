import assert from "node:assert/strict"
import test from "node:test"
import { canRetryNativeQuery, nativeSqlPolicy } from "./wobs-sql-policy.ts"

test("only explicit retryable Analytics SQL errors authorize bounded native backoff", () => {
  assert.equal(canRetryNativeQuery(Object.assign(new Error("private provider detail"), { retryable: true })), true)
  for (const error of [undefined, null, "rate limit exceeded", new Error("rate limit exceeded"), { retryable: false }, { retryable: "true" },
    { get retryable() { throw new Error("must remain private") } }]) assert.equal(canRetryNativeQuery(error), false)
  assert.equal(nativeSqlPolicy.retries.limit, 2)
  assert.equal(nativeSqlPolicy.retries.delay, "1 minute")
  assert.equal(nativeSqlPolicy.retries.backoff, "exponential")
})
