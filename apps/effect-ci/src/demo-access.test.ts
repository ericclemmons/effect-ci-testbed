import assert from "node:assert/strict";
import test from "node:test";
import { demoAccessRequest, demoRemoteAccessRoute } from "./demo-access.ts";
import { demoAccessOrigin } from "./demo-access-policy.ts";
import { accessIdentityVerifier } from "@effect-ci-testbed/github-cloudflare/access-identity";
import { worker, type WorkerEnvironment } from "@effect-ci-testbed/github-cloudflare/worker";
import { demoRunAllowed, demoRemoteTargets } from "./demo-policy.ts";

const request = (path: string, method = "GET", headers: Record<string, string> = {}) =>
  new Request(demoAccessOrigin + path, { method, headers: { "cf-access-jwt-assertion": "signed-owner-fixture", ...headers },
    ...(method === "POST" ? { body: '{"repository":"fixed","revision":"actual"}' } : {}) });

test("only the approved demo capability/run/status/event methods may use the pinned Access identity", async () => {
  for (const [method, path] of [["GET", "/demo/capabilities"], ["POST", "/demo/runs"],
    ["GET", "/demo/runs/owned-instance"], ["GET", "/demo/runs/owned-instance/events?cursor=1"]]) {
    const original = request(path!, method!); let calls = 0;
    const authorized = await demoAccessRequest(original, "internal-host-key", async value => { calls++; assert.equal(value, original); return true; });
    assert.equal(calls, 1); assert.notEqual(authorized, original);
    assert.equal(authorized.headers.get("authorization"), "Bearer internal-host-key");
    assert.equal(original.headers.has("authorization"), false);
    if (method === "POST") assert.equal(await authorized.text(), '{"repository":"fixed","revision":"actual"}');
  }
  for (const [method, path] of [["GET", "/"], ["GET", "/demo"], ["GET", "/demo/"],
    ["POST", "/runs"], ["GET", "/runs/owned/events"], ["POST", "/demo/runs/owned/approvals/review"],
    ["POST", "/demo/webhooks/slack"], ["POST", "/webhooks/github"], ["POST", "/webhooks/slack"],
    ["DELETE", "/demo/runs/owned"], ["POST", "/demo/capabilities"], ["GET", "/demo/runs"],
    ["GET", "/demo/runs/owned%2Fforeign/events"], ["GET", "/demo/runs/owned/events/extra"]]) {
    const original = request(path!, method!);
    assert.equal(demoRemoteAccessRoute(original), false, method + " " + path);
    assert.equal(await demoAccessRequest(original, "internal-host-key", async () => { throw Error("must not verify out of scope"); }), original);
  }
});

test("real signature verification composes with the existing demo enrollment gate without forwarding auth to workflow parameters", async () => {
  const issuer = "https://composed-fixture.cloudflareaccess.com", audience = "a".repeat(64), subject = "owned-fixture-user";
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = { ...await crypto.subtle.exportKey("jwk", pair.publicKey), kid: "fixture", alg: "RS256", use: "sig" };
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(subject)));
  const subjectSha256 = Array.from(digest, b => b.toString(16).padStart(2, "0")).join("");
  const verify = accessIdentityVerifier({ issuer, audience, subjectSha256 }, { fetch: async () => Response.json({ keys: [jwk] }) });
  const now = Math.floor(Date.now() / 1000), encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = encode({ alg: "RS256", kid: "fixture" }) + "." + encode({ iss: issuer, aud: [audience], sub: subject, iat: now - 1, exp: now + 300, type: "app" });
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(input));
  const token = input + "." + Buffer.from(signature).toString("base64url");
  const created: unknown[] = [], environment = { EFFECT_CI_API_TOKEN: "internal-host-key", GITHUB_APP_ID: "unused",
    GITHUB_PRIVATE_KEY: "unused", GITHUB_WEBHOOK_SECRET: "unused" } as WorkerEnvironment;
  const app = worker({ routePrefix: "/demo", remoteTargets: demoRemoteTargets,
    remoteAuthentication: ["api-token", "cloudflare-access-identity"], remoteRunAllowed: demoRunAllowed,
    workflow: () => ({ create: async (value: unknown) => { created.push(value); return { id: "fixture-instance" }; } }) as unknown as Workflow });
  const call = async (path: string, method = "GET", body?: unknown) => {
    const original = new Request(demoAccessOrigin + path, { method, headers: { "cf-access-jwt-assertion": token },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return app.fetch(await demoAccessRequest(original, environment.EFFECT_CI_API_TOKEN, verify), environment);
  };
  assert.equal((await call("/demo/capabilities")).status, 200); assert.equal(created.length, 0);
  const body = { repository: "https://github.com/ericclemmons/effect-ci-testbed.git", revision: "a".repeat(40), targets: ["test", "build"] };
  assert.equal((await call("/demo/runs", "POST", body)).status, 202); assert.equal(created.length, 1);
  assert.doesNotMatch(JSON.stringify(created), /internal-host-key|cf-access|owned-fixture-user/);
  assert.equal((await call("/demo/runs", "POST", { ...body, repository: "https://github.com/foreign/repo.git" })).status, 403);
  assert.equal((await call("/demo/runs", "POST", { ...body, targets: ["deploy"] })).status, 403);
  assert.equal(created.length, 1, "Access identity cannot enroll another repository or action");
});

test("missing, rejected or conflicting credentials never gain an internal bearer; existing API clients are untouched", async () => {
  const denied = request("/demo/capabilities");
  assert.equal(await demoAccessRequest(denied, "internal-host-key", async () => false), denied);
  assert.equal(await demoAccessRequest(denied, undefined, async () => { throw Error("missing host key"); }), denied);
  const noAssertion = new Request(demoAccessOrigin + "/demo/capabilities");
  assert.equal(await demoAccessRequest(noAssertion, "internal-host-key", async () => { throw Error("missing JWT"); }), noAssertion);
  for (const authorization of ["Bearer existing-client-key", "Bearer invalid", ""]) {
    const original = request("/demo/capabilities", "GET", { authorization });
    assert.equal(await demoAccessRequest(original, "internal-host-key", async () => { throw Error("API client must not fall back"); }), original);
    assert.equal(original.headers.get("authorization"), authorization);
  }
  for (const origin of ["http://effect-ci-github-cloudflare.ericclemmons.workers.dev", "https://preview.invalid", "https://attacker.invalid"]) {
    const original = new Request(origin + "/demo/capabilities", { headers: { "cf-access-jwt-assertion": "signed-owner-fixture" } });
    assert.equal(demoRemoteAccessRoute(original), false);
    assert.equal(await demoAccessRequest(original, "internal-host-key", async () => { throw Error("Wrong origin"); }), original);
  }
});
