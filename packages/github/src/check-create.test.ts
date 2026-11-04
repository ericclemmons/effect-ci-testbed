import assert from "node:assert/strict"
import test from "node:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { createCheck, type CreateCheckOptions } from "./index.ts"
import { Reporter } from "./reporter.ts"

const options = {
  token: "fixture", repository: "owner/repo", sha: "a".repeat(40),
  name: "test", title: "test", summary: "queued", externalId: "run:1:test",
  appSlug: "fixture-app",
}
const check = (overrides = {}) => ({
  id: 42, html_url: "https://github.com/owner/repo/runs/42",
  name: options.name, head_sha: options.sha, external_id: options.externalId,
  app: { slug: options.appSlug }, status: "in_progress", conclusion: null,
  output: { title: options.title, summary: options.summary, text: null },
  ...overrides,
})
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })

test("an explicit creation 500 reconciles the same App/head/operation before another POST", async () => {
  const original = globalThis.fetch
  const calls: { url: string; method: string; body: BodyInit | null | undefined }[] = []
  try {
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body })
      if (calls.length === 1) return new Response("", { status: 500 })
      if (calls.length === 2) return json({ total_count: 0, check_runs: [] })
      return json(check(), 201)
    }
    assert.equal((await createCheck(options)).id, 42)
    assert.deepEqual(calls.map(call => call.method), ["POST", "GET", "POST"])
    assert.equal(calls[0].url, calls[2].url)
    assert.equal(calls[0].body, calls[2].body)
    assert.match(calls[1].url, /\/commits\/[a-f0-9]{40}\/check-runs\?/)
    assert.match(calls[1].url, /filter=all/)
  } finally { globalThis.fetch = original }
})

test("a creation response lost after commit adopts the unique matching check without another POST", async () => {
  const original = globalThis.fetch
  const methods: string[] = []
  try {
    globalThis.fetch = async (_url, init) => {
      methods.push(init?.method ?? "GET")
      return methods.length === 1 ? new Response("", { status: 502 })
        : json({ total_count: 1, check_runs: [check()] })
    }
    assert.equal((await createCheck(options)).id, 42)
    assert.deepEqual(methods, ["POST", "GET"])
  } finally { globalThis.fetch = original }
})

test("GitHub's default App details URL is allowed only when the request omitted details_url", async () => {
  const original = globalThis.fetch
  try {
    for (const explicit of [false, true]) {
      const methods: string[] = []
      globalThis.fetch = async (_url, init) => {
        methods.push(init?.method ?? "GET")
        return methods.length === 1 ? new Response("", { status: 500 }) : json({
          total_count: 1, check_runs: [check({ details_url: "https://app.example.invalid" })],
        })
      }
      const request = { ...options, ...(explicit ? { detailsUrl: "https://expected.example.invalid" } : {}) }
      if (explicit) await assert.rejects(createCheck(request), /operation payload changed/)
      else assert.equal((await createCheck(request)).id, 42)
      assert.deepEqual(methods, ["POST", "GET"])
    }
  } finally { globalThis.fetch = original }
})

test("the real reporter can continue a step after the captured initial-creation 500", async () => {
  const original = globalThis.fetch
  const methods: string[] = []
  try {
    globalThis.fetch = async (_url, init) => {
      methods.push(init?.method ?? "GET")
      if (methods.length === 1) return new Response("", { status: 500 })
      if (!init?.method || init.method === "GET") return json({ total_count: 0, check_runs: [] })
      return json({ ...check(), ...JSON.parse(String(init.body)) }, 201)
    }
    const reporter = new Reporter(options)
    await reporter.report({ type: "workflow.started", workflowId: "optional-checks", mode: "execute", environment: "local", timestamp: "now" })
    await reporter.report({ type: "step.status", workflowId: "optional-checks", stepId: "test", status: "running", optional: false, timestamp: "now" })
    await reporter.report({ type: "step.status", workflowId: "optional-checks", stepId: "test", status: "complete", optional: false, timestamp: "now" })
    assert.equal(reporter.size, 1)
    assert.deepEqual(methods, ["POST", "GET", "POST", "PATCH"])
  } finally { globalThis.fetch = original }
})

test("another App, head, operation, or name is never adopted", async () => {
  const original = globalThis.fetch
  try {
    for (const foreign of [
      { app: { slug: "another-app" } }, { head_sha: "b".repeat(40) },
      { external_id: "another-run:test" }, { name: "another step" },
    ]) {
      const methods: string[] = []
      globalThis.fetch = async (_url, init) => {
        methods.push(init?.method ?? "GET")
        if (methods.length === 1) return new Response("", { status: 503 })
        if (methods.length === 2) return json({ total_count: 1, check_runs: [check(foreign)] })
        return json(check({ id: 99 }), 201)
      }
      assert.equal((await createCheck(options)).id, 99)
      assert.deepEqual(methods, ["POST", "GET", "POST"])
    }
  } finally { globalThis.fetch = original }
})

test("ambiguous, changed, or incomplete operation history stops without a second POST", async () => {
  const original = globalThis.fetch
  try {
    for (const history of [
      { total_count: 2, check_runs: [check(), check({ id: 43 })] },
      { total_count: 1, check_runs: [check({ output: { title: "changed", summary: "queued" } })] },
      { total_count: 1, check_runs: [check({ status: "completed", conclusion: "success" })] },
      { total_count: 1, check_runs: [] },
      { total_count: 1001, check_runs: [] },
      { total_count: 1, check_runs: [check({ id: -1 })] },
    ]) {
      const methods: string[] = []
      globalThis.fetch = async (_url, init) => {
        methods.push(init?.method ?? "GET")
        return methods.length === 1 ? new Response("", { status: 500 }) : json(history)
      }
      await assert.rejects(createCheck(options), /Cannot reconcile GitHub check creation/)
      assert.deepEqual(methods, ["POST", "GET"])
    }
  } finally { globalThis.fetch = original }
})

test("unavailable reconciliation cannot authorize another creation", async () => {
  const original = globalThis.fetch
  let calls = 0
  try {
    globalThis.fetch = async () => new Response("", { status: ++calls === 1 ? 500 : 403 })
    await assert.rejects(createCheck(options), /history unavailable/)
    assert.equal(calls, 2)
  } finally { globalThis.fetch = original }
})

test("permission, validation, rate, unsupported-status and transport failures stay one-shot", async () => {
  const original = globalThis.fetch
  try {
    for (const status of [400, 401, 403, 404, 409, 422, 429, 501, 0]) {
      let calls = 0
      globalThis.fetch = async () => {
        calls++
        if (status === 0) throw Error("lost connection")
        return new Response("denied", { status })
      }
      await assert.rejects(createCheck(options))
      assert.equal(calls, 1)
    }
    for (const missing of ["appSlug", "externalId"] as const) {
      const unidentified: CreateCheckOptions = { ...options }
      delete (unidentified as Partial<Record<typeof missing, unknown>>)[missing]
      let calls = 0
      globalThis.fetch = async () => { calls++; return new Response("", { status: 500 }) }
      await assert.rejects(createCheck(unidentified))
      assert.equal(calls, 1)
    }
  } finally { globalThis.fetch = original }
})

test("a persistent explicit 500 still fails after four POSTs and four reconciliations", async () => {
  const original = globalThis.fetch
  const methods: string[] = []
  try {
    globalThis.fetch = async (_url, init) => {
      methods.push(init?.method ?? "GET")
      return init?.method === "POST" ? new Response("unavailable", { status: 500 })
        : json({ total_count: 0, check_runs: [] })
    }
    await assert.rejects(createCheck(options), /GitHub create check failed \(500\): unavailable/)
    assert.deepEqual(methods, ["POST", "GET", "POST", "GET", "POST", "GET", "POST", "GET"])
  } finally { globalThis.fetch = original }
})

test("reconciliation reads all matching-name pages before adopting and rejects duplicate page entries", async () => {
  const original = globalThis.fetch
  try {
    for (const duplicate of [false, true]) {
      const calls: string[] = []
      const first = Array.from({ length: 100 }, (_, id) => check({ id: id + 100, app: { slug: "another-app" } }))
      globalThis.fetch = async (url, init) => {
        calls.push(init?.method ?? "GET")
        if (init?.method === "POST") return new Response("", { status: 504 })
        return json({ total_count: 101, check_runs: String(url).includes("page=2")
          ? [duplicate ? first[0] : check()] : first })
      }
      if (duplicate) await assert.rejects(createCheck(options), /invalid history/)
      else assert.equal((await createCheck(options)).id, 42)
      assert.deepEqual(calls, ["POST", "GET", "GET"])
    }
  } finally { globalThis.fetch = original }
})

test("target, trusted App, operation identity and serialized payload stay pinned", async () => {
  const original = globalThis.fetch
  const mutable: CreateCheckOptions = { ...options }
  const calls: { url: string; method: string; body: BodyInit | null | undefined }[] = []
  try {
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body })
      if (calls.length === 1) {
        Object.assign(mutable, { repository: "another/repo", appSlug: "another-app", externalId: "changed", summary: "changed" })
        return new Response("", { status: 500 })
      }
      if (calls.length === 2) return json({ total_count: 0, check_runs: [] })
      return json(check(), 201)
    }
    await createCheck(mutable)
    assert.deepEqual(calls[0], calls[2])
    assert.match(calls[1].url, /repos\/owner\/repo\//)
  } finally { globalThis.fetch = original }
})

test("the actual GitHub runner recovers reporting without executing its workflow again", () => {
  const root = mkdtempSync(join(tmpdir(), "effect-ci-check-reporting-"))
  const capture = join(root, "requests.jsonl")
  const bootstrap = join(root, "fetch.mjs")
  const workflow = join(root, "workflow.ts")
  writeFileSync(workflow, `import * as CI from ${JSON.stringify(pathToFileURL(resolve("packages/ci/src/index.ts")).href)};
    export const task=CI.action('test',()=>()=>console.log('BODY_EXECUTED_ONCE'));
    export default CI.workflow('optional-checks',()=>{throw new Error('selected action must not run the default')});`)
  writeFileSync(bootstrap, `import{appendFileSync}from'node:fs';let posts=0;
    globalThis.fetch=async(url,init)=>{
      appendFileSync(${JSON.stringify(capture)},JSON.stringify({url:String(url),method:init?.method??'GET',body:init?.body})+'\\n');
      if(init?.method==='POST'&&++posts===1)return new Response('',{status:500});
      if(init?.method==='GET')return Response.json({total_count:0,check_runs:[]});
      return Response.json({id:42,html_url:'https://github.com/owner/repo/runs/42'});
    };`)
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !key.startsWith("GITHUB_") && !key.startsWith("EFFECT_CI_") && key !== "DRY_RUN"))
  const result = spawnSync(process.execPath, ["--import", bootstrap, "packages/github/run.run.ts"], {
    encoding: "utf8", timeout: 15_000, env: { ...env,
      GITHUB_TOKEN: "captured-only", GITHUB_REPOSITORY: "owner/repo", EFFECT_CI_SHA: options.sha,
      EFFECT_CI_WORKFLOW: workflow, EFFECT_CI_ACTIONS: '["task"]', EFFECT_CI_APP_SLUG: options.appSlug, EFFECT_CI_EXTERNAL_ID: "fixture:run:1",
    },
  })
  assert.equal(result.status, 0, result.stdout + result.stderr + String(result.error ?? ""))
  assert.equal(result.stdout.split("BODY_EXECUTED_ONCE").length - 1, 1)
  const requests = readFileSync(capture, "utf8").trim().split("\n").map(line => JSON.parse(line))
  assert.deepEqual(requests.slice(0, 3).map(request => request.method), ["POST", "GET", "POST"])
  assert.equal(requests[0].body, requests[2].body)
  assert.equal(JSON.parse(requests[0].body).external_id, "fixture:run:1:test")
})
