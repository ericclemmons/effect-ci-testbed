import assert from "node:assert/strict"
import test from "node:test"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import { demoSecretResolver } from "./demo-secret-resolver.ts"

test("host resolver returns only redacted declared canary and fails closed without credential fallback", async () => {
  const resolver = demoSecretResolver("test-canary")
  const value = await Effect.runPromise(resolver.resolve("GITHUB_TOKEN"))
  assert.ok(Redacted.isRedacted(value))
  assert.equal(Redacted.value(value), "test-canary")
  assert.ok(!JSON.stringify(value).includes("test-canary"))
  await assert.rejects(Effect.runPromise(resolver.resolve("UNKNOWN")), /Missing required secret: UNKNOWN/)
  await assert.rejects(Effect.runPromise(demoSecretResolver().resolve("GITHUB_TOKEN")), /Missing required secret: GITHUB_TOKEN/)
})
