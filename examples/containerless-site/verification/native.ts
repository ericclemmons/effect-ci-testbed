import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { digest, SOURCE_FILES, LIMITS, filesFor } from "../src/site.ts";
export const REVISION = "cf6dd38f2cbb6e89840fb7dc75b6ee681c5eb3c0";
export const WORKFLOW = "effect-ci-containerless-site-build";
export const ORIGIN = "https://effect-ci-containerless-site.ericclemmons.workers.dev";
/** Read-only. Never dispatch, deploy or change a revision. */
export async function nativeEvidence(id: string) {
  assert.match(id, /^coverage-containerless-site(?:-replay)?-20261013-1$/);
  const get = (args: string[]) =>
    JSON.parse(
      execFileSync(process.env.CF_BIN ?? "cf", args, {
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 2 * 1024 * 1024,
      }),
    );
  const run = get(["workflows", "instances", "get", id, "--workflow-name", WORKFLOW]);
  assert.equal(run.status, "complete");
  assert.equal(run.params.revision, REVISION);
  assert.equal(run.output.revision, REVISION);
  assert.equal(run.output.containers, 0);
  assert.deepEqual(
    run.steps.map((s: any) => s.name),
    ["source-1", "build-1", "publish-1", "verify-1"],
  );
  assert.ok(
    run.steps.every(
      (s: any) => s.success && s.attempts.length === 1 && s.config.retries.limit === 0,
    ),
  );
  assert.equal(run.output.plan.nodes.length, 4);
  assert.ok(
    run.output.plan.nodes.every(
      (n: any) => n.status === "complete" && n.commands.length === 0 && n.secrets.length === 0,
    ),
  );
  const step = (name: string) => {
    const result = get([
      "workflows",
      "instances",
      "step",
      "get",
      id,
      "--workflow-name",
      WORKFLOW,
      "--name",
      `${name}-1`,
      "--type",
      "step",
    ]).result;
    assert.equal(result.status, "complete");
    assert.equal(result.error, null);
    return result.output;
  };
  const source = filesFor(step("source"), LIMITS.sourceBytes);
  assert.deepEqual(Object.keys(source).sort(), [...SOURCE_FILES].sort());
  // Independent immutable GitHub reads, not just agreement between stored outputs.
  for (const name of SOURCE_FILES) {
    const response = await fetch(
      `https://raw.githubusercontent.com/ericclemmons/effect-ci-testbed/${REVISION}/examples/containerless-site/site/${name}`,
      { redirect: "manual", signal: AbortSignal.timeout(10_000) },
    );
    assert.equal(response.status, 200);
    assert.equal(await response.text(), source[name]);
  }
  const assets = filesFor(step("build"));
  const site = step("publish");
  assert.equal(site.revision, REVISION);
  assert.equal(site.sourceDigest, await digest(source));
  assert.equal(site.assetDigest, await digest(assets));
  assert.deepEqual(site.assets, assets);
  // The URL is short and untruncated in instance history; avoid another full-output request.
  assert.equal(
    run.steps.find((s: any) => s.name === "verify-1").output,
    `${ORIGIN}/r/${REVISION}/index.html`,
  );
  const served = [];
  for (const [path, expected] of Object.entries(assets)) {
    const response = await fetch(`${ORIGIN}/r/${REVISION}/${path}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-source-revision"), REVISION);
    assert.equal(response.headers.get("x-site-digest"), site.assetDigest);
    assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'none'/);
    assert.equal(await response.text(), expected);
    served.push({
      path,
      status: response.status,
      bytes: Buffer.byteLength(expected),
      contentType: response.headers.get("content-type"),
    });
  }
  assert.equal((await fetch(`${ORIGIN}/r/${REVISION}/missing.js`)).status, 404);
  assert.equal(
    (await fetch(`${ORIGIN}/r/${REVISION}/index.html`, { method: "POST", body: "not-a-build" }))
      .status,
    405,
  );
  const milliseconds = (start: string, end: string) => Date.parse(end) - Date.parse(start);
  return {
    version: 1,
    instanceId: id,
    sourceRevision: REVISION,
    workflowId: WORKFLOW,
    workflowVersion: run.versionId,
    siteUrl: run.output.siteUrl,
    sourceDigest: site.sourceDigest,
    assetDigest: site.assetDigest,
    containers: 0,
    run,
    source,
    assets,
    served,
    timing: {
      queueMs: milliseconds(run.queued, run.start),
      executionMs: milliseconds(run.start, run.end),
      totalMs: milliseconds(run.queued, run.end),
      steps: run.steps.map((s: any) => ({ name: s.name, ms: milliseconds(s.start, s.end) })),
      cache: "unknown",
      samples: 1,
    },
    browserVerified: false,
    videoVerified: false,
    hostedCpuEnforcementVerified: false,
  };
}
export function rejectedEvidence() {
  const run = JSON.parse(
    execFileSync(
      process.env.CF_BIN ?? "cf",
      [
        "workflows",
        "instances",
        "get",
        "coverage-containerless-site-rejected-20261013-1",
        "--workflow-name",
        WORKFLOW,
      ],
      { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 },
    ),
  );
  assert.equal(run.status, "errored");
  assert.equal(run.params.revision, "main");
  assert.equal(run.step_count, 0);
  assert.ok(run.output == null);
  return run;
}
