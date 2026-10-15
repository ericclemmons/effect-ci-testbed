import assert from "node:assert/strict";
import test from "node:test";
import { prepareCandidate, type CandidateRecord } from "./candidate.ts";
import { demoSite, demoSiteUrl } from "@effect-ci-testbed/cloudflare/demo-site";
import {
  demoCandidateModule,
  readPublishedDemo,
} from "@effect-ci-testbed/cloudflare/demo-candidate";
import { RELEASE_ACCOUNT, RELEASE_SCRIPT } from "./release-manager.ts";
const revision = "a".repeat(40),
  version = "11111111-1111-4111-8111-111111111111";
const assets = {
  "index.html": "<h1>Vite</h1>",
  "app.js": 'import "./message.js"',
  "message.js": 'export const message="hello"',
};
const site = await demoSite(revision, assets);
test("owned public bytes -> one fixed-target version upload, readback, unchanged allocation, completed replay", async () => {
  let record: CandidateRecord | undefined,
    posts = 0,
    reads = 0,
    metadata: any;
  const store = {
    read: async () => record,
    claim: async (r: CandidateRecord) => {
      assert.equal(record, undefined);
      record = structuredClone(r);
    },
    complete: async (r: CandidateRecord) => {
      record = structuredClone(r);
    },
  };
  const transport: typeof fetch = async (input, init) => {
    const url = String(input);
    assert.equal(init?.redirect, "manual");
    if (url.startsWith("https://effect-ci-demo-site.")) {
      assert.equal(init?.headers, undefined);
      assert.ok(!url.includes("token"));
      const name = url.split("/").at(-1)!;
      return new Response(assets[name as keyof typeof assets], {
        headers: { "x-site-revision": revision, "x-site-digest": site.digest },
      });
    }
    assert.match(
      url,
      new RegExp(
        `^https://api.cloudflare.com/client/v4/accounts/${RELEASE_ACCOUNT}/workers/scripts/${RELEASE_SCRIPT}/`,
      ),
    );
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fake-owned-token");
    if (url.includes("/deployments")) {
      assert.notEqual(init?.method, "POST");
      reads++;
      return Response.json({
        success: true,
        result: {
          deployments: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              versions: [{ version_id: "33333333-3333-4333-8333-333333333333", percentage: 100 }],
            },
          ],
        },
      });
    }
    if (init?.method === "POST") {
      posts++;
      assert.equal(record?.status, "pending");
      assert.ok(init.body instanceof FormData);
      metadata = JSON.parse(await (init.body.get("metadata") as Blob).text());
      const module = await (init.body.get("index.js") as Blob).text();
      assert.equal(module, (await demoCandidateModule(site)).module);
      assert.equal(metadata.main_module, "index.js");
      assert.equal(metadata.bindings.length, 2);
      assert.equal(metadata.annotations["workers/commit_sha"], revision);
      return Response.json({ success: true, result: { id: version } });
    }
    assert.ok(url.endsWith("/versions/" + version));
    return Response.json({
      success: true,
      result: {
        id: version,
        metadata: { annotations: metadata.annotations },
        resources: { bindings: metadata.bindings },
      },
    });
  };
  const receipt = await prepareCandidate(
    store,
    revision,
    site.digest,
    () => "fake-owned-token",
    transport,
  );
  assert.equal(receipt.version, version);
  assert.equal(record?.status, "complete");
  assert.equal(posts, 1);
  assert.equal(reads, 2);
  assert.deepEqual(
    await prepareCandidate(
      store,
      revision,
      site.digest,
      () => {
        throw Error("No credential access on historical replay");
      },
      async () => {
        throw Error("No network on historical replay");
      },
    ),
    receipt,
  );
  await assert.rejects(
    prepareCandidate(store, revision, "b".repeat(64), () => "", transport),
    /reconciliation/,
  );
  assert.equal(posts, 1);
});
test("ambiguous upload retains pending; second request cannot allocate another version", async () => {
  let record: CandidateRecord | undefined,
    posts = 0;
  const store = {
    read: async () => record,
    claim: async (r: CandidateRecord) => {
      record = r;
    },
    complete: async () => {
      throw Error("must not complete");
    },
  };
  const transport: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith("https://effect-ci-demo-site."))
      return new Response(assets[url.split("/").at(-1)! as keyof typeof assets], {
        headers: { "x-site-revision": revision, "x-site-digest": site.digest },
      });
    if (init?.method === "POST") {
      posts++;
      throw Error("Lost ACK: fake-secret must not leak");
    }
    return Response.json({
      success: true,
      result: {
        deployments: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            versions: [{ version_id: "33333333-3333-4333-8333-333333333333", percentage: 100 }],
          },
        ],
      },
    });
  };
  await assert.rejects(
    prepareCandidate(store, revision, site.digest, () => "fake-token", transport),
    (e) => e instanceof Error && !e.message.includes("fake-secret"),
  );
  assert.equal(record?.status, "pending");
  await assert.rejects(
    prepareCandidate(store, revision, site.digest, () => "", transport),
    /reconciliation/,
  );
  assert.equal(posts, 1);
});
test("unpublished/redirected/tampered/oversize/foreign inputs fail before candidate claim or credential", async () => {
  for (const response of [
    () => new Response(null, { status: 302, headers: { location: "https://bad.invalid" } }),
    () =>
      new Response("tampered", {
        headers: { "x-site-revision": revision, "x-site-digest": site.digest },
      }),
    () =>
      new Response("x".repeat(256 * 1024 + 1), {
        headers: { "x-site-revision": revision, "x-site-digest": site.digest },
      }),
  ]) {
    let claims = 0;
    await assert.rejects(
      prepareCandidate(
        {
          read: async () => undefined,
          claim: async () => {
            claims++;
          },
          complete: async () => {},
        },
        revision,
        site.digest,
        () => {
          throw Error("No token access");
        },
        async () => response(),
      ),
    );
    assert.equal(claims, 0);
  }
  await assert.rejects(
    readPublishedDemo("main", site.digest, async () => {
      throw Error("No network");
    }),
  );
  assert.match(demoSiteUrl(site), /^https:\/\/effect-ci-demo-site\./);
});
