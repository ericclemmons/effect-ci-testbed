import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  verifyOwnedRepair,
  OWNED_BASE,
  OWNED_NODE_COMMAND,
  OWNED_PACKAGE,
  OWNED_TEST,
  HOST_CHECK_NAME,
  type ExecuteOwnedNode,
} from "./repair-verifier.ts";
import {
  FIXED_SOURCE,
  REPAIR_BASE,
  REPAIR_REPOSITORY,
  repairBlobHash,
  repairTreeHash,
} from "./repair.ts";
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const credentials = { appId: "5089816", privateKey };
const commit = "c".repeat(40);
const digest = createHash("sha256").update(FIXED_SOURCE).digest("hex");
function harness() {
  const state = {
    revoked: 0,
    executed: 0,
    created: 0,
    tamper: false,
    symlink: false,
    treeTamper: false,
    truncated: false,
    drift: false,
    failed: false,
    foreign: false,
    check: undefined as any,
  };
  let baseReads = 0;
  const fetcher: typeof fetch = async (url, init) => {
    const target = new URL(String(url));
    assert.equal(target.origin, "https://api.github.com");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (target.pathname === "/app/installations/165265172/access_tokens") {
      assert.deepEqual(body, {
        repositories: ["effect-ci-private-github-fixture"],
        permissions: { contents: "read", checks: "write" },
      });
      return Response.json({
        token: "private-host-only",
        permissions: { contents: "read", checks: "write", metadata: "read" },
      });
    }
    if (target.pathname === "/installation/token") {
      state.revoked++;
      return new Response(null, { status: 204 });
    }
    assert.equal(init?.redirect, "manual");
    assert.ok(init?.signal);
    const path = target.pathname.slice(`/repos/${REPAIR_REPOSITORY}`.length);
    const entries = (await Promise.all(
      [
        ["health.js", FIXED_SOURCE],
        ["health.test.mjs", OWNED_TEST],
        ["package.json", OWNED_PACKAGE],
      ].map(async ([path, text]) => ({
        path: path!,
        mode: state.symlink && path === "health.js" ? "120000" : "100644",
        type: "blob",
        sha: await repairBlobHash(text!),
      })),
    )) as any;
    const directorySha = await repairTreeHash(entries);
    const rootEntries = [
      { path: "repair-demo", mode: "040000", type: "tree", sha: directorySha },
    ] as any;
    const rootSha = await repairTreeHash(rootEntries);
    if (path === `/git/trees/${rootSha}`)
      return Response.json({
        sha: rootSha,
        truncated: state.truncated,
        tree: state.treeTamper
          ? rootEntries.map((entry: any) => ({ ...entry, path: "changed" }))
          : rootEntries,
      });
    if (path === `/git/trees/${directorySha}`)
      return Response.json({ sha: directorySha, truncated: false, tree: entries });
    if (path === `/git/ref/heads/${REPAIR_BASE}`) {
      baseReads++;
      return Response.json({
        ref: `refs/heads/${REPAIR_BASE}`,
        object: { type: "commit", sha: state.drift && baseReads > 1 ? "d".repeat(40) : OWNED_BASE },
      });
    }
    if (path === "/git/ref/heads/codex/repair-owned")
      return Response.json({
        ref: "refs/heads/codex/repair-owned",
        object: { type: "commit", sha: commit },
      });
    if (path === `/git/commits/${commit}`)
      return Response.json({
        sha: commit,
        tree: { sha: rootSha },
        parents: [{ sha: OWNED_BASE }],
        message: `Repair owned demo health status\n\nEffect-CI-Repair: owned\nEffect-CI-Base: ${OWNED_BASE}\nEffect-CI-Patch-SHA256: ${digest}`,
      });
    if (path.startsWith("/contents/repair-demo/")) {
      assert.equal(target.searchParams.get("ref"), commit);
      const file = path.slice("/contents/".length);
      const text = file.endsWith("health.js")
        ? FIXED_SOURCE
        : file.endsWith("health.test.mjs")
          ? OWNED_TEST
          : OWNED_PACKAGE;
      return Response.json({
        path: file,
        type: state.symlink ? "symlink" : "file",
        sha: await repairBlobHash(text),
        encoding: "base64",
        content: btoa(state.tamper ? "secret bad source" : text),
      });
    }
    if (path === `/commits/${commit}/check-runs`)
      return Response.json({
        check_runs: state.check ? [state.check] : [],
        total_count: state.check ? 1 : 0,
      });
    if (path === "/check-runs" && init?.method === "POST") {
      state.created++;
      assert.equal(state.executed, state.created === 1 ? 1 : state.executed);
      assert.equal(body.name, HOST_CHECK_NAME);
      assert.equal(body.head_sha, commit);
      assert.equal(body.conclusion, "success");
      assert.ok(!JSON.stringify(body).includes("private-host-only"));
      state.check = { ...body, id: 123, app: { id: state.foreign ? 999 : 5089816 } };
      return Response.json(state.check);
    }
    assert.fail(`Unexpected fixed path ${path}`);
  };
  const execute: ExecuteOwnedNode = async (files, command) => {
    state.executed++;
    assert.equal(command, OWNED_NODE_COMMAND);
    assert.deepEqual(
      files.map((f) => f.path),
      ["repair-demo/health.js", "repair-demo/health.test.mjs", "repair-demo/package.json"],
    );
    if (state.failed) return { exitCode: 1, stdout: "failed", stderr: "secret upstream error" };
    const directory = mkdtempSync(join(tmpdir(), "effect-ci-native-verifier-test-"));
    mkdirSync(join(directory, "repair-demo"));
    for (const file of files)
      writeFileSync(join(directory, file.path), Buffer.from(file.base64, "base64"), { flag: "wx" });
    const result = spawnSync(process.execPath, ["--test", "repair-demo/health.test.mjs"], {
      cwd: directory,
      env: {},
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 64 * 1024,
    });
    assert.equal(result.error, undefined);
    return { exitCode: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
  };
  return { state, run: () => verifyOwnedRepair(credentials, commit, "owned", execute, fetcher) };
}
test("exact bytes -> real local Node -> owned check, replay does not duplicate checks", async () => {
  const h = harness();
  assert.deepEqual(await h.run(), {
    commit,
    sourceDigest: digest,
    passed: true,
    evidenceId: "github_check_123",
  });
  await h.run();
  assert.equal(h.state.created, 1);
  assert.equal(h.state.executed, 2);
  assert.equal(h.state.revoked, 2);
});
for (const flag of ["tamper", "symlink", "treeTamper", "truncated"] as const)
  test(`${flag} cannot reach execution or publish a check`, async () => {
    const h = harness();
    h.state[flag] = true;
    await assert.rejects(h.run(), /Owned native verification rejected/);
    assert.equal(h.state.executed, 0);
    assert.equal(h.state.created, 0);
    assert.equal(h.state.revoked, 1);
  });
test("failed actual execution cannot create a success check; errors are redacted", async () => {
  const h = harness();
  h.state.failed = true;
  await assert.rejects(
    h.run(),
    /^Error: Owned native verification rejected; reconcile before retrying$/,
  );
  assert.equal(h.state.created, 0);
  assert.equal(h.state.revoked, 1);
});
test("foreign check identity and post-execution ref drift cannot authorize a PR", async () => {
  for (const flag of ["foreign", "drift"] as const) {
    const h = harness();
    h.state[flag] = true;
    await assert.rejects(h.run(), /Owned native verification rejected/);
    assert.equal(h.state.revoked, 1);
  }
});
test("invalid host inputs rejected before tokens or execution", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    throw new Error("must not fetch");
  };
  await assert.rejects(
    verifyOwnedRepair(
      credentials,
      "main",
      "owned",
      async () => {
        throw new Error("must not execute");
      },
      fetcher,
    ),
  );
  await assert.rejects(
    verifyOwnedRepair(
      credentials,
      commit,
      "../other",
      async () => {
        throw new Error("must not execute");
      },
      fetcher,
    ),
  );
  assert.equal(calls, 0);
});
