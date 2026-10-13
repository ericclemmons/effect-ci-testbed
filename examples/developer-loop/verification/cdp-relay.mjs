import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import { clearTimeout, setTimeout } from "node:timers";
import WebSocket, { WebSocketServer } from "ws";

const MAX_BYTES = 1024 * 1024;

export function cloudflareBrowserEndpoint(endpoint, accountId, sessionId) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("Unexpected browser endpoint");
  }
  if (
    !/^[a-f0-9]{32}$/.test(accountId) ||
    !/^[A-Za-z0-9-]{1,128}$/.test(sessionId) ||
    url.protocol !== "wss:" ||
    url.host !== "api.cloudflare.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !==
      `/client/v4/accounts/${accountId}/browser-rendering/devtools/browser/${sessionId}`
  )
    throw new Error("Unexpected browser endpoint");
  return url.href;
}

/** Trusted host only. Never import this adapter into a project sandbox or Worker.
 * Authentication is requested only after endpoint validation. The returned local
 * endpoint is a short-lived capability, not a credential to publish in reports.
 * connect is an explicit trusted host transport seam, not project configuration.
 */
export async function openCdpRelay({
  endpoint,
  accountId,
  sessionId,
  authorization,
  signal,
  lifetimeMs = 60_000,
  connect = (url, options) => new WebSocket(url, options),
}) {
  const upstreamUrl = cloudflareBrowserEndpoint(endpoint, accountId, sessionId);
  if (!Number.isInteger(lifetimeMs) || lifetimeMs < 1 || lifetimeMs > 60_000)
    throw new Error("Invalid browser transport lifetime");
  if (signal?.aborted) throw new Error("Browser transport cancelled");
  let auth;
  let authTimer;
  let cancelAuth;
  try {
    auth = await Promise.race([
      Promise.resolve().then(authorization),
      new Promise((_resolve, reject) => {
        cancelAuth = () => reject(new Error("cancelled"));
        signal?.addEventListener("abort", cancelAuth, { once: true });
        authTimer = setTimeout(cancelAuth, Math.min(lifetimeMs, 10_000));
      }),
    ]);
  } catch {
    throw new Error("Browser authentication unavailable");
  } finally {
    clearTimeout(authTimer);
    signal?.removeEventListener("abort", cancelAuth);
  }
  if (typeof auth !== "string" || !/^Bearer [A-Za-z0-9._~-]{1,8192}$/.test(auth))
    throw new Error("Browser authentication unavailable");
  if (signal?.aborted) throw new Error("Browser transport cancelled");
  const path = `/cdp/${randomUUID()}`;
  const server = createServer((_request, response) => {
    response.writeHead(404);
    response.end();
  });
  const sockets = new Set();
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_BYTES,
    perMessageDeflate: false,
  });
  let closed = false;
  let active;
  let closing;
  let expiry;
  const close = () => {
    if (closing) return closing;
    closed = true;
    clearTimeout(expiry);
    signal?.removeEventListener("abort", close);
    for (const socket of sockets) socket.terminate();
    closing = new Promise((resolve) => {
      wss.close();
      if (!server.listening) resolve();
      else server.close(() => resolve());
    });
    return closing;
  };
  server.on("upgrade", (request, socket, head) => {
    // A browser page must not be able to steal a loopback CDP capability.
    if (
      closed ||
      active ||
      request.url !== path ||
      request.headers.origin ||
      request.headers.host !== `127.0.0.1:${server.address()?.port}`
    ) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (client) => wss.emit("connection", client));
  });
  wss.on("connection", (client) => {
    active = client;
    let upstream;
    try {
      upstream = connect(upstreamUrl, {
        headers: { Authorization: auth },
        followRedirects: false,
        maxPayload: MAX_BYTES,
        perMessageDeflate: false,
        handshakeTimeout: 10_000,
      });
    } catch {
      client.terminate();
      active = undefined;
      return;
    }
    sockets.add(client);
    sockets.add(upstream);
    const pending = [];
    let pendingBytes = 0;
    const stop = () => {
      client.terminate();
      upstream.terminate();
    };
    const send = (to, data, binary) => {
      if (to.bufferedAmount + data.length > MAX_BYTES) {
        stop();
        return;
      }
      to.send(data, { binary }, (error) => {
        if (error) stop();
      });
    };
    client.on("message", (data, binary) => {
      if (upstream.readyState === WebSocket.OPEN) send(upstream, data, binary);
      else if (
        upstream.readyState === WebSocket.CONNECTING &&
        pending.length < 32 &&
        pendingBytes + data.length <= MAX_BYTES
      ) {
        pending.push([data, binary]);
        pendingBytes += data.length;
      } else stop();
    });
    upstream.on("open", () => {
      for (const [data, binary] of pending) send(upstream, data, binary);
      pending.length = 0;
      pendingBytes = 0;
    });
    upstream.on("message", (data, binary) => {
      if (client.readyState === WebSocket.OPEN) send(client, data, binary);
    });
    for (const socket of [client, upstream]) {
      socket.on("error", stop);
      socket.on("close", () => {
        sockets.delete(socket);
        pending.length = 0;
        pendingBytes = 0;
        if (socket === client) active = undefined;
        stop();
      });
    }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    signal?.addEventListener("abort", close, { once: true });
    expiry = setTimeout(close, lifetimeMs);
    expiry.unref();
    if (signal?.aborted) {
      await close();
      throw new Error("Browser transport cancelled");
    }
    return { cdpEndpoint: `ws://127.0.0.1:${server.address().port}${path}`, close };
  } catch {
    await close();
    throw new Error("Browser transport unavailable");
  }
}
