import assert from "node:assert/strict"
import test from "node:test"
import * as Effect from "effect/Effect"
import * as Tools from "@effect-ci-testbed/source-tools"
import { makeSourceTools } from "@effect-ci-testbed/cloudflare-dynamic-worker"

test("source tools default to local formatting without mutating input", async () => {
  const request = { files: { "index.ts": "const value=1;\n" }, options: { semi: false } }
  const result = await Effect.runPromise(Tools.format(request))
  assert.equal(result.runtime, "local")
  assert.equal(result.files["index.ts"], "const value = 1\n")
  assert.equal(request.files["index.ts"], "const value=1;\n")
})

test("runner service uses a Dynamic Worker RPC rather than the local formatter", async () => {
  let calls = 0
  const loader = {
    get: (id: string) => {
      assert.match(id, /prettier-3\.6\.2/)
      return {
        getEntrypoint: (name: string) => {
          assert.equal(name, "Formatter")
          return {
            format: async (request: Tools.FormatRequest) => {
              calls++
              return { files: request.files, runtime: "dynamic-worker" as const }
            },
          }
        },
      }
    },
  } as unknown as WorkerLoader
  const request = { files: { "index.ts": "source passed through RPC" } }
  const result = await Effect.runPromise(Tools.format(request).pipe(
    Effect.provideService(Tools.SourceTools, makeSourceTools(loader)),
  ))
  assert.equal(calls, 1)
  assert.equal(result.runtime, "dynamic-worker")
  assert.deepEqual(result.files, request.files)
})
