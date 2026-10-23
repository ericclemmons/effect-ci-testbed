import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import test from "node:test";

test("OIDC setup reuses native self-hosting account and subdomain without copying its credentials", () => {
  const dir = mkdtempSync(join(tmpdir(), "oidc-setup-"));
  const native = join(dir, "native"); mkdirSync(native);
  const host = join(native, ".env.production");
  const cf = join(dir, "cf"); const gh = join(dir, "gh");
  writeFileSync(cf, `#!/usr/bin/env node
const cmd=process.argv[2];
console.log(JSON.stringify(cmd==='auth'?{authenticated:true,email:'owner@example.com',accounts:[{id:'${"a".repeat(32)}',name:'Sandbox'}]}:
cmd==='zero-trust'?{id:'service-id',client_id:'native-access-id',client_secret:'native-access-secret'}:
cmd==='workers'?[{name:'my-worker',id:'${"b".repeat(32)}'}]:[{name:'Individual Workers Editor',id:'editor-role'}]));`, { mode: 0o700 });
  const generated = spawnSync(process.execPath, [new URL("../../../effect-ci/scripts/setup.ts", import.meta.url).pathname, "--subdomain", "sandbox"], {
    cwd: native, encoding: "utf8", env: { PATH: process.env.PATH, CF_BIN: cf },
  });
  assert.equal(generated.status, 0, generated.stderr);
  writeFileSync(gh, '#!/usr/bin/env node\nconsole.log(JSON.stringify({id:123,owner:{id:456},default_branch:"main"}));', { mode: 0o700 });
  const run = (extra: string[] = []) => spawnSync(process.execPath, [new URL("../../scripts/setup-oidc.ts", import.meta.url).pathname,
    "--", "--host-env", host, "--repository", "owner/repo", "--worker", "my-worker", ...extra], {
    cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH, CF_BIN: cf, GH_BIN: gh },
  });
  try {
    const first = run(); assert.equal(first.status, 0, first.stderr);
    const settings = parseEnv(readFileSync(join(dir, ".env.production"), "utf8"));
    assert.equal(settings.CLOUDFLARE_ACCOUNT_ID, "a".repeat(32));
    assert.equal(settings.BROKER_AUDIENCE, "https://effect-ci-github-actions-runner.sandbox.workers.dev");
    assert.equal(settings.EFFECT_CI_OIDC_ONLY, "true");
    assert.equal(settings.EFFECT_CI_API_TOKEN, undefined);
    assert.equal(settings.CF_ACCESS_CLIENT_SECRET, undefined);
    const grants = JSON.parse(settings.BROKER_GRANTS!);
    assert.deepEqual(grants.map((grant: { workflowRef: string }) => grant.workflowRef), [
      "owner/repo/.github/workflows/e2e.yml@refs/heads/main",
      "owner/repo/.github/workflows/oidc-live-proof.yml@refs/heads/main",
    ]);
    assert.deepEqual(Object.keys(grants[0].scopes), ["workers:edit"]);
    assert.deepEqual(grants[0].scopes["workers:edit"][0].resources, { [`com.cloudflare.api.account.${"a".repeat(32)}`]: { [`com.cloudflare.edge.worker.script.${"b".repeat(32)}`]: "*" } });
    assert.equal(statSync(join(dir, ".env.production")).mode & 0o777, 0o600);
    assert.equal(run().status, 0);
    assert.equal(parseEnv(readFileSync(join(dir, ".env.production"), "utf8")).RECEIPT_SIGNING_KEY, settings.RECEIPT_SIGNING_KEY);
    const selected = run(["--ref", "main", "--ref", "integration", "--workflow", ".github/workflows/custom.yml"]);
    assert.equal(selected.status, 0, selected.stderr);
    const selectedGrants = JSON.parse(parseEnv(readFileSync(join(dir, ".env.production"), "utf8")).BROKER_GRANTS!);
    assert.deepEqual(selectedGrants.map((grant: { workflowRef: string }) => grant.workflowRef), [
      "owner/repo/.github/workflows/custom.yml@refs/heads/main",
      "owner/repo/.github/workflows/custom.yml@refs/heads/integration",
    ], "explicit workflows replace defaults without wildcard refs");
    const wrong = run(["--account", "c".repeat(32)]); assert.notEqual(wrong.status, 0); assert.match(wrong.stderr, /another account/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
