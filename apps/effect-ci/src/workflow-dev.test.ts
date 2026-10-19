import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { resolveConfig } from "vite";

test("Cloudflare dev loads CI source without exposing state, output or credentials", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const config = await resolveConfig({ root, configFile: resolve(root, "vite.config.ts") }, "serve");
  const denied = (config as unknown as { fsDenyGlob(path: string): boolean }).fsDenyGlob;
  assert.equal(denied(resolve(root, "../../.cloudflare/ci/workflow.ts")), false);
  for (const path of [".cloudflare/state/token", ".cloudflare/output/index.js", ".cloudflare/secret.json",
    ".cloudflare/ci/.env", ".cloudflare/ci/signing.key", ".env", ".dev.vars", ".git/config", ".wrangler/state/token"])
    assert.equal(denied(resolve(root, path)), true, path);
});
