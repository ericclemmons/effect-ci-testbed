import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("CLI negotiates explicit compute reruns before dispatch and never silently starts a fresh suite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-ci-rerun-cli-"));
  const server = createServer();
  const received: unknown[] = [];
  let supportsRerun = true;
  try {
    await writeFile(join(directory, "ci.ts"), `import * as CI from ${JSON.stringify(fileURLToPath(new URL("../../ci/src/index.ts", import.meta.url)))};export default CI.workflow('fixture',function*(){});`);
    for (const args of [["init", "-q"], ["config", "user.name", "Fixture"], ["config", "user.email", "fixture@example.invalid"],
      ["add", "ci.ts"], ["commit", "-qm", "fixture"], ["remote", "add", "origin", "https://github.com/example/project.git"]])
      execFileSync("git", args, { cwd: directory });
    server.on("request", async (request, response) => {
      assert.equal(request.headers.authorization, "Bearer fixture-token");
      response.setHeader("content-type", "application/json");
      if (request.url === "/capabilities") return response.end(JSON.stringify({ protocol: "effect-ci-remote-v1", targets: ["test", "build"],
        ...(supportsRerun ? { rerun: true } : {}) }));
      if (request.url === "/runs") {
        let body = ""; for await (const chunk of request) body += chunk;
        received.push(JSON.parse(body)); response.statusCode = 202;
        return response.end(JSON.stringify({ instanceId: "fixture", eventsUrl: "/runs/fixture/events" }));
      }
      response.setHeader("content-type", "application/x-ndjson");
      response.end(JSON.stringify({ eventId: 1, type: "workflow_completed" }) + "\n");
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const run = (args: string[]) => new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(new URL("./bin.ts", import.meta.url)), ...args, "--format=json", "--workflow", join(directory, "ci.ts")], {
        cwd: directory, env: { ...process.env, EFFECT_CI_REMOTE_URL: `http://127.0.0.1:${address.port}`, EFFECT_CI_REMOTE_TOKEN: "fixture-token",
          EFFECT_CI_REMOTE_PROFILE: join(directory, "no-profile.json"), CF_ACCESS_TOKEN: "", CF_ACCESS_CLIENT_ID: "", CF_ACCESS_CLIENT_SECRET: "" },
      });
      let output = ""; child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { output += chunk; });
      child.on("error", reject); child.on("close", code => resolve({ code, output }));
    });
    const previous = "11111111-1111-4111-8111-111111111111";
    const accepted = await run(["run", "test", "--remote", "--rerun-from", previous]);
    assert.equal(accepted.code, 0, accepted.output);
    assert.equal(received.length, 1);
    assert.equal((received[0] as { rerunFrom: string }).rerunFrom, previous);
    assert.deepEqual((received[0] as { targets: string[] }).targets, ["test"]);
    supportsRerun = false;
    const oldHost = await run(["run", "test", "--remote", "--rerun-from", previous]);
    assert.equal(oldHost.code, 3, oldHost.output);
    for (const args of [["run", "test", "--local", "--rerun-from", previous], ["run", "--remote", "--rerun-from", previous],
      ["run", "test", "--remote", "--rerun-from", "foreign"]]) {
      const invalid = await run(args); assert.equal(invalid.code, 2, invalid.output);
    }
    assert.equal(received.length, 1, "unsupported or invalid reruns never become fresh suite dispatches");
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
