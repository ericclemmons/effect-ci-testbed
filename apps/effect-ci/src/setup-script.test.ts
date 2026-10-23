import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { parseEnv } from "node:util"

test("setup discovers identity, persists scoped credentials, and preserves them on retry", () => {
  const directory = mkdtempSync(join(tmpdir(), "effect-ci-setup-test-"))
  const cli = join(directory, "cf")
  const log = join(directory, "calls.jsonl")
  const file = join(directory, ".env.production")
  writeFileSync(cli, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, account: process.env.CLOUDFLARE_ACCOUNT_ID }) + "\\n");
if (args[0] === "auth") console.log(JSON.stringify({
  authenticated: true, email: "reviewer@example.com",
  accounts: JSON.parse(process.env.FIXTURE_ACCOUNTS),
}));
else console.log(JSON.stringify({ id: "service-id", client_id: "client-id", client_secret: "client-secret" }));
`, { mode: 0o700 })
  const run = (accounts: Array<{ id: string; name: string }>, args: string[] = []) => spawnSync(process.execPath, [
    new URL("../scripts/setup.ts", import.meta.url).pathname, ...args,
  ], {
    cwd: directory,
    encoding: "utf8",
    env: { PATH: process.env.PATH, CF_BIN: cli, FIXTURE_ACCOUNTS: JSON.stringify(accounts) },
  })
  try {
    const accounts = [{ id: "account-a", name: "Account A" }]
    const first = run(accounts, ["--subdomain", "fixture"])
    assert.equal(first.status, 0, first.stderr)
    const settings = parseEnv(readFileSync(file, "utf8"))
    assert.equal(settings.CLOUDFLARE_ACCOUNT_ID, "account-a")
    assert.equal(settings.EFFECT_CI_ACCESS_REVIEWERS, "reviewer@example.com")
    assert.equal(settings.EFFECT_CI_PUBLIC_URL, "https://effect-ci.fixture.workers.dev")
    assert.equal(settings.CF_ACCESS_CLIENT_SECRET, "client-secret")
    assert.equal(settings.EFFECT_CI_ACCESS_SERVICE_TOKEN_ID, "service-id")
    assert.equal(settings.EFFECT_CI_PROFILE, "standalone")
    assert.match(settings.EFFECT_CI_API_TOKEN!, /^[a-f0-9]{64}$/)
    assert.equal(statSync(file).mode & 0o777, 0o600)
    assert.doesNotMatch(first.stdout + first.stderr, /client-secret/)
    const second = run(accounts)
    assert.equal(second.status, 0, second.stderr)
    assert.deepEqual(parseEnv(readFileSync(file, "utf8")), settings)
    const calls = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line))
    const creates = calls.filter((call) => call.args.includes("create"))
    assert.equal(creates.length, 1)
    assert.equal(creates[0].account, "account-a")

    rmSync(file)
    const multiple = [...accounts, { id: "account-b", name: "Account B" }]
    const ambiguous = run(multiple, ["--subdomain", "fixture"])
    assert.notEqual(ambiguous.status, 0)
    assert.equal(existsSync(file), false)
    const selected = run(multiple, ["--account", "account-b", "--subdomain", "fixture"])
    assert.equal(selected.status, 0, selected.stderr)
    assert.equal(parseEnv(readFileSync(file, "utf8")).CLOUDFLARE_ACCOUNT_ID, "account-b")
    const mismatched = run(multiple, ["--account", "account-a"])
    assert.notEqual(mismatched.status, 0)
    assert.equal(parseEnv(readFileSync(file, "utf8")).CLOUDFLARE_ACCOUNT_ID, "account-b")
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
