import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { brokerOrigin, exchange, revoke } from "./client.mjs";

const input = { broker: "https://broker.example", worker: "my-worker", scopes: "workers:edit", requestUrl: "https://github.example/token?job=1", requestToken: "github-request-token" };
const credentials = { token: "temporary-secret", receipt: "revocation-receipt", accountId: "a".repeat(32) };
test("OIDC audience and requested Worker/scopes reach the broker, without a CF secret", async () => {
  const calls = [];
  const result = await exchange(input, async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(calls.length === 1 ? { value: "signed-identity" } : credentials);
  });
  assert.equal(new URL(calls[0].url).searchParams.get("audience"), input.broker);
  assert.equal(calls[1].url, "https://broker.example/token");
  assert.equal(calls[1].init.headers.authorization, "Bearer signed-identity");
  assert.deepEqual(JSON.parse(calls[1].init.body), { worker: "my-worker", scopes: ["workers:edit"] });
  assert.equal(result.token, credentials.token);
});
test("reject HTTP, credentials, paths and query parameters in broker origins", () => {
  for (const url of ["http://broker.example", "https://user:pass@broker.example", "https://broker.example/path", "https://broker.example?token=x"]) assert.throws(() => brokerOrigin(url));
});
test("missing OIDC permission, broker denial and newline credentials fail without reflection", async () => {
  await assert.rejects(exchange({ ...input, requestToken: "" }), /id-token: write/);
  let calls = 0;
  await assert.rejects(exchange(input, async () => ++calls === 1 ? Response.json({ value: "identity" }) : new Response("reflected-secret", { status: 403 })), /^Error: Effect CI credential exchange failed \(403\)$/);
  calls = 0;
  await assert.rejects(exchange(input, async () => Response.json(++calls === 1 ? { value: "identity" } : { ...credentials, token: "secret\nINJECTED=value" })), /Invalid broker response/);
});
test("cleanup authenticates with receipt and reports revocation failure", async () => {
  await revoke(input.broker, credentials.receipt, async (url, init) => {
    assert.equal(url, "https://broker.example/revoke");
    assert.equal(init.headers.authorization, "Bearer revocation-receipt");
    return Response.json({ revoked: true });
  });
  await assert.rejects(revoke(input.broker, credentials.receipt, async () => new Response(null, { status: 403 })), /expiration remains in effect/);
});
test("diagnostics expose only known failure stages, never arbitrary broker error text", async () => {
  for (const stage of ["identity", "secret-reflected-from-server"]) {
    let calls = 0;
    await assert.rejects(exchange(input, async () => ++calls === 1
      ? Response.json({ value: "signed-identity" })
      : Response.json({ stage, error: "private-upstream-body" }, { status: 403 })), (error) => {
        assert.equal(error.message, stage === "identity"
          ? "Effect CI credential exchange failed (403; stage=identity)"
          : "Effect CI credential exchange failed (403)");
        return true;
      });
  }
});
test("action exports masked credentials, saves cleanup state, and its post step revokes", () => {
  const dir = mkdtempSync(join(tmpdir(), "effect-ci-oidc-"));
  const envFile = join(dir, "env");
  const stateFile = join(dir, "state");
  const mockedFetch = `globalThis.fetch = async (url) => Response.json(String(url).includes('/revoke') ? {revoked:true} : String(url).includes('/token?') ? {value:'signed-identity'} : ${JSON.stringify(credentials)});`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", mockedFetch + `await import(${JSON.stringify(new URL("./index.mjs", import.meta.url).href)});`], {
    encoding: "utf8", env: { ...process.env, "INPUT_BROKER-URL": input.broker, INPUT_WORKER: input.worker, INPUT_SCOPES: input.scopes, ACTIONS_ID_TOKEN_REQUEST_URL: input.requestUrl, ACTIONS_ID_TOKEN_REQUEST_TOKEN: input.requestToken, GITHUB_ENV: envFile, GITHUB_STATE: stateFile },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /::add-mask::temporary-secret/);
  assert.match(readFileSync(envFile, "utf8"), /CLOUDFLARE_API_TOKEN=temporary-secret\nCLOUDFLARE_ACCOUNT_ID=/);
  assert.match(readFileSync(stateFile, "utf8"), /receipt=revocation-receipt/);
  const post = spawnSync(process.execPath, ["--input-type=module", "-e", mockedFetch + `await import(${JSON.stringify(new URL("./post.mjs", import.meta.url).href)});`], {
    encoding: "utf8", env: { ...process.env, STATE_broker: input.broker, STATE_receipt: credentials.receipt },
  });
  assert.equal(post.status, 0, post.stderr);
  assert.match(post.stdout, /revoked/);
});

test("root checkout discovers its host and enrolls before ordinary deployment credentials are exported", () => {
  const root = mkdtempSync(join(tmpdir(), "effect-ci-auth-journey-"));
  mkdirSync(join(root, ".cloudflare/ci"), { recursive: true });
  writeFileSync(join(root, ".cloudflare/ci/oidc.json"), JSON.stringify({ issuer: input.broker }));
  const envFile = join(root, "env");
  const stateFile = join(root, "state");
  const script = `
    import assert from 'node:assert/strict';
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push(String(url));
      if (String(url).includes('/token?')) return Response.json({ value: 'signed-identity' });
      if (String(url).endsWith('/api/oidc/repositories')) {
        assert.deepEqual(JSON.parse(init.body), { repository: 'owner/walkthrough' });
        assert.equal(init.headers.authorization, 'Bearer signed-identity');
        return Response.json({ enabled: true, issuer: ${JSON.stringify(input.broker)}, repository: 'owner/walkthrough' });
      }
      assert.equal(String(url), ${JSON.stringify(input.broker + "/token")});
      return Response.json(${JSON.stringify(credentials)});
    };
    await import(${JSON.stringify(new URL("./index.mjs", import.meta.url).href)});
    assert.equal(process.exitCode ?? 0, 0);
    assert.deepEqual(calls.map(url => new URL(url).pathname), ['/token', '/api/oidc/repositories', '/token']);
  `;
  const env = { ...process.env, "INPUT_BROKER-URL": "", EFFECT_CI_REMOTE_URL: "",
    INPUT_ENROLL: "true", INPUT_WORKER: "walkthrough", GITHUB_REPOSITORY: "owner/walkthrough",
    GITHUB_WORKSPACE: root, GITHUB_ENV: envFile, GITHUB_STATE: stateFile,
    ACTIONS_ID_TOKEN_REQUEST_URL: input.requestUrl, ACTIONS_ID_TOKEN_REQUEST_TOKEN: input.requestToken };
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", env });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const deploymentEnvironment = Object.fromEntries(readFileSync(envFile, "utf8").trim().split("\n").map(line => line.split("=")));
  assert.equal(deploymentEnvironment.CLOUDFLARE_API_TOKEN, credentials.token);
  assert.equal(deploymentEnvironment.CLOUDFLARE_ACCOUNT_ID, credentials.accountId);
  assert.match(readFileSync(stateFile, "utf8"), /receipt=revocation-receipt/);
});
