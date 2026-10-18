import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { withRepositoryCheckoutToken } from "./checkout-auth.ts";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const credentials = { appId: "1234", privateKey };
const repository = "https://github.com/acme/private.git";

test("remote checkout resolves the host App installation, restricts one repo and revokes before returning", async () => {
  const events: string[] = [];
  const request: typeof fetch = async (url, init) => {
    assert.equal(init?.redirect, "manual");
    const path = new URL(String(url)).pathname;
    events.push(path);
    if (path === "/repos/acme/private/installation") {
      assert.match(new Headers(init?.headers).get("authorization")!, /^Bearer ey/);
      return Response.json({ id: 101, app_id: 1234 });
    }
    if (path === "/app/installations/101/access_tokens") {
      assert.deepEqual(JSON.parse(String(init?.body)), {
        repositories: ["private"],
        permissions: { contents: "read" },
      });
      return Response.json(
        { token: "fixture_checkout_token", permissions: { contents: "read", metadata: "read" } },
        { status: 201 },
      );
    }
    assert.equal(path, "/installation/token");
    assert.equal(init?.method, "DELETE");
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer fixture_checkout_token");
    return new Response(null, { status: 204 });
  };
  assert.equal(
    await withRepositoryCheckoutToken(
      credentials,
      repository,
      async (token) => {
        assert.equal(token, "fixture_checkout_token");
        events.push("checkout");
        return "completed";
      },
      request,
    ),
    "completed",
  );
  assert.deepEqual(events, [
    "/repos/acme/private/installation",
    "/app/installations/101/access_tokens",
    "checkout",
    "/installation/token",
  ]);
});

test("missing installations and other public providers never receive GitHub credentials", async () => {
  let reads = 0,
    operations = 0;
  const request: typeof fetch = async () => {
    reads++;
    return new Response(null, { status: 404 });
  };
  for (const source of [repository, "https://gitlab.com/acme/public.git"]) {
    await withRepositoryCheckoutToken(
      credentials,
      source,
      async (token) => {
        assert.equal(token, undefined);
        operations++;
      },
      request,
    );
  }
  assert.equal(reads, 1);
  assert.equal(operations, 2);
});

test("bad identities, redirects, malformed responses and reflected failures cannot reach checkout", async () => {
  for (const response of [
    () => Response.json({ id: 101, app_id: 5678 }),
    () => Response.json({ id: -1, app_id: 1234 }),
    () =>
      new Response("reflected-private-value", {
        status: 302,
        headers: { location: "https://evil.invalid" },
      }),
    () => new Response("reflected-private-value", { status: 403 }),
    () => new Response("reflected-private-value"),
    () => Response.json({ value: "x".repeat(65_536) }),
  ]) {
    let reads = 0;
    await assert.rejects(
      withRepositoryCheckoutToken(
        credentials,
        repository,
        async () => assert.fail("checkout reached"),
        async () => {
          reads++;
          return response();
        },
      ),
      (error) =>
        error instanceof Error &&
        /^GitHub checkout /.test(error.message) &&
        !/reflected|private-value|evil/.test(error.message),
    );
    assert.equal(reads, 1);
  }
  for (const source of [
    "https://github.com/acme/private?token=secret",
    "https://github.com/../private",
    "https://github.com/acme/private/",
  ]) {
    await assert.rejects(
      withRepositoryCheckoutToken(
        credentials,
        source,
        async () => assert.fail("checkout reached"),
        async () => assert.fail("network reached"),
      ),
    );
  }
});

test("operation failure or an overprivileged token still revokes; revocation failure cannot claim success", async () => {
  for (const scenario of ["operation", "scope", "revocation"] as const) {
    let writes = 0,
      operations = 0;
    const request: typeof fetch = async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/installation")) return Response.json({ id: 101, app_id: 1234 });
      if (path.endsWith("/access_tokens"))
        return Response.json(
          {
            token: "fixture_checkout_token",
            permissions: { contents: scenario === "scope" ? "write" : "read" },
          },
          { status: 201 },
        );
      assert.equal(init?.method, "DELETE");
      writes++;
      return new Response(null, { status: scenario === "revocation" ? 503 : 204 });
    };
    await assert.rejects(
      withRepositoryCheckoutToken(
        credentials,
        repository,
        async () => {
          operations++;
          if (scenario === "operation") throw Error("checkout failed");
        },
        request,
      ),
      scenario === "operation"
        ? /checkout failed/
        : /GitHub checkout (token scope|revocation) failed/,
    );
    assert.equal(writes, 1);
    assert.equal(operations, scenario === "scope" ? 0 : 1);
  }
});
