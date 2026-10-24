import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

test("deployment reads production settings and uploads only Worker secrets", () => {
  const directory = mkdtempSync(join(tmpdir(), "effect-ci-deploy-test-"))
  const calls = join(directory, "calls.jsonl")
  const cli = join(directory, "cf")
  const production = join(directory, ".env.production")
  writeFileSync(cli, `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
const secretsIndex = args.indexOf("--secrets-file");
appendFileSync(${JSON.stringify(calls)}, JSON.stringify({
  args,
  ...(secretsIndex < 0 ? {} : { secrets: JSON.parse(readFileSync(args[secretsIndex + 1], "utf8")) }),
}) + "\\n");
if (args.at(-1) === "list") console.log("[]");
else if (args[0] !== "deploy") console.log("{}");
if (args[0] === "deploy") process.exit(Number(process.env.FIXTURE_DEPLOY_EXIT ?? 0));
`, { mode: 0o700 })
  writeFileSync(production, [
    "CLOUDFLARE_ACCOUNT_ID=fixture-account",
    "CLOUDFLARE_API_TOKEN=operator-api-token",
    "EFFECT_CI_PUBLIC_URL=https://ci.example.com",
    "EFFECT_CI_ACCESS_REVIEWERS=reviewer@example.com",
    "EFFECT_CI_ACCESS_SERVICE_TOKEN_ID=fixture-service-id",
    "CF_ACCESS_CLIENT_ID=operator-client-id",
    "CF_ACCESS_CLIENT_SECRET=operator-client-secret",
    "EFFECT_CI_API_TOKEN=worker-api-token",
    'GITHUB_PRIVATE_KEY="line one\nline two"',
  ].join("\n"), { mode: 0o600 })

  try {
    for (const exitCode of [0, 1]) {
      writeFileSync(calls, "")
      const result = spawnSync(process.execPath, [
        `--env-file=${production}`,
        new URL("../scripts/deploy.ts", import.meta.url).pathname,
        "--prebuilt",
      ], {
        cwd: directory,
        encoding: "utf8",
        env: { PATH: process.env.PATH, CF_BIN: cli, FIXTURE_DEPLOY_EXIT: String(exitCode) },
      })
      assert.equal(result.status, exitCode, result.stderr)
      const recorded = readFileSync(calls, "utf8").trim().split("\n").map((line) => JSON.parse(line))
      const service = recorded.find((call) => call.args.includes("create") &&
        JSON.parse(call.args.at(-1)).domain === "ci.example.com")
      assert.equal(JSON.parse(service.args.at(-1)).policies[1].include[0].service_token.token_id, "fixture-service-id")
      const deployment = recorded.at(-1)
      assert.deepEqual(deployment.secrets, {
        GITHUB_PRIVATE_KEY: "line one\nline two",
        EFFECT_CI_API_TOKEN: "worker-api-token",
        EFFECT_CI_PUBLIC_URL: "https://ci.example.com",
      })
      assert.equal(existsSync(deployment.args[deployment.args.indexOf("--secrets-file") + 1]), false)
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
