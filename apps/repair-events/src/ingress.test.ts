import assert from "node:assert/strict";
import test from "node:test";
import {
  authenticated,
  boundedBody,
  digest,
  MAX_BYTES,
  notificationKind,
} from "./ingress.ts";
test("fixed shared-secret authentication and capture-only classification", async () => {
  const secret = "a".repeat(64);
  assert.equal(await authenticated(secret, secret), true);
  for (const input of [null, "", "b".repeat(64), "a".repeat(63)])
    assert.equal(await authenticated(input, secret), false);
  assert.equal(await authenticated(secret, ""), false);
  assert.equal(
    notificationKind(
      '{"alert_type":"workers_observability_real_time_issue","data":{}}',
    ),
    "quarantine",
  );
  assert.equal(
    notificationKind(
      JSON.stringify({
        text: "Hello World! This is a test message sent from https://cloudflare.com. If you can see this, your webhook is configured properly.",
      }),
    ),
    "test",
  );
  for (const body of [
    "null",
    "[]",
    '{"text":"not an Issue"}',
    '{"alert_type":"workers_observability_alert","data":{}}',
    '{"alert_type":"workers_observability_real_time_issue","data":[]}',
  ])
    assert.throws(() => notificationKind(body));
  assert.equal((await digest("owned")).length, 64);
});
test("body bounds enforce actual bytes, encoding and streamed size", async () => {
  const request = (body: string, headers: Record<string, string> = {}) =>
    new Request("https://owned.invalid/notifications", {
      method: "POST",
      body,
      headers,
    });
  assert.equal(await boundedBody(request("{}")), "{}");
  await assert.rejects(boundedBody(request("a".repeat(MAX_BYTES + 1))));
  await assert.rejects(
    boundedBody(request("{}", { "content-length": String(MAX_BYTES + 1) })),
  );
  await assert.rejects(
    boundedBody(request("{}", { "content-encoding": "gzip" })),
  );
  const broken = new Request("https://owned.invalid/", {
    method: "POST",
    body: new Uint8Array([0xc0, 0xaf]),
  });
  await assert.rejects(boundedBody(broken));
  assert.throws(() => notificationKind("\uFEFF{}"));
});
test(
  "a stalled authenticated body reaches its fixed deadline and is cancelled",
  { timeout: 8000 },
  async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request("https://owned.invalid/", {
      method: "POST",
      body,
      duplex: "half",
    } as any);
    await assert.rejects(boundedBody(request));
    assert.equal(cancelled, true);
  },
);
