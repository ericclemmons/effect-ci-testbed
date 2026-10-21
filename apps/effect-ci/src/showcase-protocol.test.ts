import assert from "node:assert/strict";
import test from "node:test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ShowcaseGoals, ShowcaseVersion, decodeShowcasePublication } from "./showcase-protocol.ts";

test("showcase protocol uses Schema for closed goals, UUIDs and encoded byte identities", async () => {
  const receipt = { revision: "a".repeat(40), digest: "b".repeat(64), url: "https://site.invalid/preview" };
  assert.deepEqual(await Effect.runPromise(decodeShowcasePublication(receipt)), receipt);
  for (const change of [{ revision: "main" }, { revision: "a".repeat(39) }, { digest: "g".repeat(64) }, { digest: "b".repeat(62) }, { url: "not a URL" }]) {
    await assert.rejects(Effect.runPromise(decodeShowcasePublication({ ...receipt, ...change })), /Invalid showcase publication receipt/);
  }
  assert.deepEqual(Schema.decodeUnknownSync(ShowcaseGoals)(["test", "build"]), ["test", "build"]);
  assert.throws(() => Schema.decodeUnknownSync(ShowcaseGoals)(["test", "test"]));
  assert.throws(() => Schema.decodeUnknownSync(ShowcaseGoals)(["release"]));
  assert.throws(() => Schema.decodeUnknownSync(ShowcaseVersion)("not a version"));
});
