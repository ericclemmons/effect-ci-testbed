import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { parseEnv } from "node:util"
import test from "node:test"

const baseline = "09593237-23b2-4873-bd04-88c8e8488840"
const candidates = { healthy: "c94cee12-0bf4-48fb-bb42-9235f7ab7a3c", regression: "02de9b2e-95d0-49e6-b787-467e25c5a65c" }
const command = (...args: string[]) => JSON.parse(execFileSync(process.env.HMD_CF_BIN ?? "cf", args,
  { encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }))
const checkpoint = (run: any, name: string) => {
  const step = run.steps.find((entry: any) => entry.name === `${name}-1`)
  assert.equal(step?.success, true, name)
  assert.equal(step.output?.includes("[truncated"), false, name)
  return JSON.parse(step.output)
}

/** Recorded-run assertions only: no dispatch, event, upload, approval or mutation. */
for (const profile of ["healthy", "regression"] as const) {
  const instance = process.env[profile === "healthy" ? "HMD_SAMPLING_HEALTHY_INSTANCE" : "HMD_SAMPLING_REGRESSION_INSTANCE"]
  test(`live cumulative HMD samples preserve one card and fixed deadlines: ${profile}`, { skip: !instance, timeout: 60_000 }, async () => {
    const run = command("workflows", "instances", "get", instance!, "--workflow-name", "effect-ci-hmd-review")
    assert.equal(run.status, profile === "healthy" ? "complete" : "errored")
    assert.equal(run.params.intent, "hmd-review-lab")
    assert.equal(run.params.profile ?? "healthy", profile)
    assert.match(run.params.revision, /^[a-f0-9]{40}$/)
    const native = run.params.telemetry === "experimental-native-wobs"
    const evidenceSource = native ? "experimental-native-wobs" : "closed-client-http-cohort"
    if (profile === "healthy") {
      assert.equal(run.output.releaseCommitted, false)
      assert.equal(run.output.wobsVerified, false)
      assert.equal(run.output.evidenceSource, evidenceSource)
    }
    const phases = profile === "healthy" ? [10, 25, 75, 100] : [10]
    const images = run.steps.filter((s: any) => s.name.startsWith("notification:hmd-image-"))
    assert.ok(images.length > phases.length, "real refreshes render new private graph receipts")
    for (const image of images) {
      const receipt = checkpoint(run, image.name.slice(0, -2))
      assert.equal(receipt.ok, true)
      assert.match(receipt.fileId, /^F[A-Z0-9]+$/)
    }
    const cards = run.steps.filter((s: any) => s.name.startsWith("notification:") && !s.name.startsWith("notification:hmd-image-"))
      .map((s: any) => checkpoint(run, s.name.slice(0, -2)))
    assert.ok(cards.length > images.length)
    assert.equal(cards[0].sequence, 0)
    assert.ok(cards.every((card: any, index: number) => card.ts === cards[0].ts && card.sequence === index), "all frames edit exactly one owned message")
    for (const phase of phases) {
      const requests = run.steps.filter((s: any) => new RegExp(`^review:request-${phase}(?:-sample-\\d+)?-poll-\\d+-1$`).test(s.name))
        .map((s: any) => checkpoint(run, s.name.slice(0, -2)))
      assert.ok(requests.length >= 2, `stage ${phase} has actual repeated evidence`)
      let trials = -1, failures = -1
      const digests = new Set<string>()
      for (const request of requests) {
        assert.equal(request.baselineVersion, baseline)
        assert.equal(request.candidateVersion, candidates[profile])
        assert.equal(request.evidenceSource, evidenceSource)
        assert.equal(request.baselineTrials, 100)
        assert.equal(request.expiresAt, requests[0].expiresAt, "sampling never extends the original deadline")
        assert.ok(request.candidateTrials >= trials && request.candidateFailures >= failures)
        assert.match(request.snapshot, /^[a-f0-9]{64}$/)
        digests.add(request.snapshot)
        trials = request.candidateTrials; failures = request.candidateFailures
      }
      assert.ok(digests.size >= 2)
      assert.ok(trials > requests[0].candidateTrials, "candidate observations actually accumulate")
      const promoted = checkpoint(run, `release:promote-${phase}`)
      assert.equal(promoted.deployment.versions.find((v: any) => v.version === candidates[profile]).percentage, phase)
      const waits = run.steps.filter((s: any) => s.name.startsWith(`review:phase-${phase}-poll-`))
      assert.ok(waits.length >= 2)
      assert.ok(waits.every((s: any) => s.type === "waitForEvent" && s.error && !s.output), "no human event was fabricated")
      if (profile === "healthy") {
        const resolution = run.steps.find((s: any) => new RegExp(`^review:resolve-${phase}(?:-sample-\\d+)?-1$`).test(s.name))
        const accepted = checkpoint(run, resolution.name.slice(0, -2))
        assert.equal(accepted.status, "advance")
        assert.equal(accepted.basis, "deadline-risk-acceptance", "inconclusive evidence is not healthy proof")
        assert.ok(accepted.acceptedAt >= requests[0].expiresAt)
        checkpoint(run, `release:verify-after-review-${phase}`)
      } else {
        assert.ok(requests.some((r: any) => /Regression detected/.test(r.reason)))
        if (native) {
          const conclusive = requests.find((r: any) => r.telemetry?.complete && r.candidateBounds?.low > r.margins.maxErrorRate)
          assert.ok(conclusive, "early native regression needs complete conclusive bounds, not a partial count")
          assert.equal(conclusive.earlyRegression, true)
          assert.equal(conclusive.telemetry.missing, 0)
          assert.equal(conclusive.telemetry.invalid, 0)
        } else assert.ok(failures >= 20)
        assert.equal(run.steps.some((s: any) => s.name === "release:promote-25-1"), false)
        const resolution = run.steps.find((s: any) => /^review:resolve-10(?:-sample-\d+)?-1$/.test(s.name))
        assert.equal(resolution?.success, false)
        assert.equal(resolution.attempts.length, 1, "regression deadline rejection is non-retryable")
        assert.match(resolution.attempts[0].error.message, /Progression deadline cannot accept this stage/)
        assert.ok(Date.parse(resolution.start) >= requests[0].expiresAt)
        assert.match(run.error?.message ?? "", /prior allocation restored/)
      }
    }
    const restored = checkpoint(run, profile === "healthy" ? "release:lab-cleanup" : "release:restore-baseline")
    assert.equal(restored.status, "rolled-back")
    assert.deepEqual(restored.deployment.versions, [{ version: baseline, percentage: 100 }])
    // Another sequential lab may supersede this run's deployment ID, not its recorded recovery.
    const latest = command("workers", "deployments", "list", "--worker", "effect-ci-hmd-demo", "--per-page", "1").deployments[0]
    assert.deepEqual(latest.versions, [{ version_id: baseline, percentage: 100 }])

    if (process.env.HMD_SLACK_SECRETS_FILE) {
      const env = parseEnv(await readFile(process.env.HMD_SLACK_SECRETS_FILE, "utf8"))
      assert.ok(env.SLACK_BOT_TOKEN && env.SLACK_CHANNEL_ID && env.SLACK_APP_ID)
      const response = await fetch("https://slack.com/api/conversations.history", { method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000),
        headers: { authorization: `Bearer ${env.SLACK_BOT_TOKEN}`, "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ channel: env.SLACK_CHANNEL_ID, oldest: cards[0].ts, latest: cards[0].ts, inclusive: true, limit: 1 }) })
      assert.equal(response.status, 200)
      const history = await response.json() as any
      assert.equal(history.ok, true, "Slack history read failed")
      const message = history.messages.find((m: any) => m.ts === cards[0].ts)
      assert.equal(message?.app_id, env.SLACK_APP_ID)
      const lastImage = checkpoint(run, images.at(-1).name.slice(0, -2))
      assert.ok(message.blocks.some((b: any) => b.type === "image" && b.slack_file?.id === lastImage.fileId))
      assert.ok(!message.blocks.some((b: any) => b.elements?.some((e: any) => e.action_id === "hmd_approve" || e.action_id === "hmd_reject")))
      // Recorded cards may receive a deliberate presentation-only cleanup;
      // native outcome/rollback assertions above remain the source of truth.
      assert.match(message.text, profile === "healthy" ? /Passed|Previous version restored/ : /Failed|Rolled back/)
      if (/^(?:↩️|:leftwards_arrow_with_hook:)/.test(message.text)) {
        assert.match(message.text,/(?:↩️|:leftwards_arrow_with_hook:) Restore previous version/)
        assert.ok(!/(?:✅|:white_check_mark:) Restore previous version/.test(message.text))
      }
      assert.equal(JSON.stringify(message.blocks).includes("queued"), false, "terminal cards have no stuck queued stages")
    }
  })
}
