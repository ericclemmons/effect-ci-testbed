import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createServer } from "node:http";
import { Buffer } from "node:buffer";
import { setTimeout } from "node:timers";
import WebSocket, { WebSocketServer } from "ws";
import { cloudflareBrowserEndpoint, openCdpRelay } from "./cdp-relay.mjs";

const accountId = "a".repeat(32);
const sessionId = "test-browser";
const endpoint = `wss://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/devtools/browser/${sessionId}`;
const base = {
  endpoint,
  accountId,
  sessionId,
  authorization: async () => "Bearer inert-test-only",
};

test("only the exact owned Cloudflare browser receives host authorization", async () => {
  for (const bad of [
    endpoint + "?token=secret",
    endpoint + "#x",
    endpoint.replace("test-browser", "another"),
    endpoint.replace("api.cloudflare.com", "evil.invalid"),
    endpoint.replace("wss:", "ws:"),
    endpoint.replace("api.cloudflare.com", "user:secret@api.cloudflare.com"),
    endpoint.replace(accountId, "b".repeat(32)),
  ]) {
    let authCalls = 0;
    await assert.rejects(
      openCdpRelay({
        ...base,
        endpoint: bad,
        authorization: () => {
          authCalls++;
          return "Bearer secret";
        },
      }),
    );
    assert.equal(authCalls, 0);
  }
  assert.equal(cloudflareBrowserEndpoint(endpoint, accountId, sessionId), endpoint);
  await assert.rejects(openCdpRelay({ ...base, authorization: () => "Bearer invalid\r\nsecret" }), {
    message: "Browser authentication unavailable",
  });
});

test("real loopback WebSockets forward CDP text/binary, keep auth upstream, and close on abort", async () => {
  const server = createServer();
  const wss = new WebSocketServer({ server });
  let receivedAuth;
  wss.on("connection", (socket, request) => {
    receivedAuth = request.headers.authorization;
    socket.on("message", (data, binary) => socket.send(data, { binary }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const controller = new globalThis.AbortController();
  const relay = await openCdpRelay({
    ...base,
    signal: controller.signal,
    connect: (url, options) => {
      assert.equal(url, endpoint);
      assert.equal(options.followRedirects, false);
      return new WebSocket(`ws://127.0.0.1:${server.address().port}`, options);
    },
  });
  const client = new WebSocket(relay.cdpEndpoint);
  try {
    assert.ok(!relay.cdpEndpoint.includes("inert-test-only"));
    await once(client, "open");
    const text = once(client, "message");
    client.send('{"id":1,"method":"Browser.getVersion"}');
    const [data, binary] = await text;
    assert.equal(binary, false);
    assert.equal(data.toString(), '{"id":1,"method":"Browser.getVersion"}');
    assert.equal(receivedAuth, "Bearer inert-test-only");
    const image = once(client, "message");
    client.send(Buffer.from([0, 1, 255]));
    const [bytes, isBinary] = await image;
    assert.equal(isBinary, true);
    assert.deepEqual(bytes, Buffer.from([0, 1, 255]));
    const ended = once(client, "close");
    controller.abort();
    await ended;
    await relay.close();
    await relay.close();
    await assert.rejects(globalThis.fetch(relay.cdpEndpoint.replace("ws:", "http:")));
  } finally {
    client.terminate();
    await relay.close();
    for (const socket of wss.clients) socket.terminate();
    wss.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("pages and wrong capabilities fail closed before upstream authentication", async () => {
  let connections = 0;
  const relay = await openCdpRelay({
    ...base,
    connect: () => {
      connections++;
      return new WebSocket("ws://127.0.0.1:1");
    },
  });
  try {
    for (const [url, options] of [
      [relay.cdpEndpoint, { origin: "https://untrusted.invalid" }],
      [relay.cdpEndpoint + "wrong", {}],
    ]) {
      const socket = new WebSocket(url, options);
      await once(socket, "error");
      socket.terminate();
    }
    assert.equal(connections, 0);
    assert.equal((await globalThis.fetch(relay.cdpEndpoint.replace("ws:", "http:"))).status, 404);
  } finally {
    await relay.close();
  }
});

test("authentication errors are redacted and a stalled callback has a bounded lifetime", async () => {
  await assert.rejects(
    openCdpRelay({
      ...base,
      authorization: () => {
        throw new Error("secret-value");
      },
    }),
    { message: "Browser authentication unavailable" },
  );
  await assert.rejects(
    openCdpRelay({ ...base, lifetimeMs: 10, authorization: () => new Promise(() => {}) }),
    { message: "Browser authentication unavailable" },
  );
});

test("only one active client can attach and oversize traffic closes the transport pair", async () => {
  const server = createServer();
  const wss = new WebSocketServer({ server });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const relay = await openCdpRelay({
    ...base,
    connect: (_url, options) => new WebSocket(`ws://127.0.0.1:${server.address().port}`, options),
  });
  const first = new WebSocket(relay.cdpEndpoint);
  try {
    await once(first, "open");
    const second = new WebSocket(relay.cdpEndpoint);
    await once(second, "error");
    second.terminate();
    const ended = once(first, "close");
    first.send(Buffer.alloc(1024 * 1024 + 1));
    await ended;
  } finally {
    first.terminate();
    await relay.close();
    for (const socket of wss.clients) socket.terminate();
    wss.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("the loopback listener expires even when the runner never calls cleanup", async () => {
  const relay = await openCdpRelay({ ...base, lifetimeMs: 30 });
  await new Promise((resolve) => setTimeout(resolve, 60));
  await assert.rejects(globalThis.fetch(relay.cdpEndpoint.replace("ws:", "http:")));
  await relay.close();
});

test("pre-cancelled acquisition does not read authentication or open a listener", async () => {
  const controller = new globalThis.AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(
    openCdpRelay({
      ...base,
      signal: controller.signal,
      authorization: () => {
        calls++;
      },
    }),
    { message: "Browser transport cancelled" },
  );
  assert.equal(calls, 0);
});
