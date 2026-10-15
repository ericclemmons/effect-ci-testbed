import assert from "node:assert/strict";
import test from "node:test";
import { demoSite, demoSiteUrl } from "./demo-site.ts";
import { demoCandidateModule } from "./demo-candidate.ts";
test("generated release Worker is a source-bound pointer, never evaluates project JavaScript", async () => {
  const site = await demoSite("a".repeat(40), {
    "index.html": "<h1>actual</h1>",
    "app.js": 'throw new Error("project code must not run in release host")',
    "message.js": 'export const message="hello"',
  });
  const built = await demoCandidateModule(site);
  assert.match(built.moduleDigest, /^[a-f0-9]{64}$/);
  assert.equal(built.module.includes("project code must not run"), false);
  const worker = (
    await import("data:text/javascript;base64," + Buffer.from(built.module).toString("base64"))
  ).default;
  const env = {
    WORKER_METADATA: { id: "11111111-1111-4111-8111-111111111111" },
    FAILURE_RATE: "0",
  };
  const redirect = worker.fetch(new Request("https://target.invalid/"), env);
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("location"), demoSiteUrl(site));
  const health = worker.fetch(new Request("https://target.invalid/health"), env);
  assert.deepEqual(await health.json(), {
    version: env.WORKER_METADATA.id,
    healthy: true,
    revision: site.revision,
    digest: site.digest,
  });
  assert.equal(
    worker.fetch(new Request("https://target.invalid/"), { ...env, FAILURE_RATE: "1" }).status,
    503,
  );
  assert.equal(
    worker.fetch(new Request("https://target.invalid/", { method: "POST" }), env).status,
    405,
  );
  assert.equal(worker.fetch(new Request("https://target.invalid/admin"), env).status, 404);
});
