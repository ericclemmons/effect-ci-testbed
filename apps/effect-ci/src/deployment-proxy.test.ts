import assert from "node:assert/strict";
import test from "node:test";
import { DeploymentProxy, deploymentToken } from "./deployment-proxy.ts";

test("outbound proxy adds host-only account and registry authentication, never returning registry secrets", async () => {
  const calls: Request[] = [];
  const proxy = new DeploymentProxy("account", "private-account-token", async request => {
    calls.push(request);
    return request.url.endsWith("/credentials")
      ? Response.json({ success: true, result: { username: "v1", password: "private-registry-password" } })
      : new Response("ok");
  });
  const send = (url: string) => proxy.fetch(new Request(url, { headers: { authorization: `Bearer ${deploymentToken}` } }));
  assert.equal((await send("https://registry.cloudflare.com/v2/")).status, 403);
  const result = await send("https://api.cloudflare.com/client/v4/accounts/account/containers/registries/registry.cloudflare.com/credentials");
  assert.equal(await result.text(), JSON.stringify({ success: true, result: { username: deploymentToken, password: deploymentToken } }));
  assert.equal(calls[0].headers.get("authorization"), "Bearer private-account-token");
  assert.equal(await (await send("https://registry.cloudflare.com/v2/account/image/manifests/latest")).text(), "ok");
  assert.equal(calls[1].headers.get("authorization"), `Basic ${btoa("v1:private-registry-password")}`);
  for (const url of ["https://api.cloudflare.com/client/v4/accounts/other/workers/scripts", "http://api.cloudflare.com/client/v4/accounts/account/workers/scripts", "https://attacker.invalid/", "https://api.cloudflare.com/client/v4/user/tokens"])
    assert.equal((await send(url)).status, 403);
  assert.equal(calls.length, 2);
});

test("proxy does not follow redirects or expose transport error credentials", async () => {
  const proxy = new DeploymentProxy("account", "private", async request => {
    assert.equal(request.redirect, "manual");
    throw Error("private");
  });
  const result = await proxy.fetch(new Request("https://api.cloudflare.com/client/v4/accounts/account/workers/scripts"));
  assert.equal(result.status, 502);
  assert.equal(await result.text(), "Deployment upstream request failed");
});

test("Docker bearer exchanges also retain real tokens outside the container", async () => {
  const proxy = new DeploymentProxy("account", "private", async request => {
    if (request.url.endsWith("/credentials")) return Response.json({ result: { username: "v1", password: "registry-secret" } });
    if (request.url.endsWith("/token")) return Response.json({ token: "registry-bearer", access_token: "registry-bearer", expires_in: 60 });
    assert.equal(request.headers.get("authorization"), "Bearer registry-bearer");
    return new Response("published");
  });
  await proxy.fetch(new Request("https://api.cloudflare.com/client/v4/accounts/account/containers/registries/registry.cloudflare.com/credentials"));
  const token = await (await proxy.fetch(new Request("https://registry.cloudflare.com/token"))).json();
  assert.deepEqual(token, { token: deploymentToken, access_token: deploymentToken, expires_in: 60 });
  assert.equal(await (await proxy.fetch(new Request("https://registry.cloudflare.com/v2/account/image/manifests/latest", {
    headers: { authorization: `Bearer ${deploymentToken}` },
  }))).text(), "published");
});
