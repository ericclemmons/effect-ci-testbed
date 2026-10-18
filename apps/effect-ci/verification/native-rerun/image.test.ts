import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { original, changed, programChanged, publicSource } from "./source.ts";

test("the built isolated image runs the pinned public program without network, credentials or root writes", {
  skip: process.env.VERIFY_NATIVE_RERUN_IMAGE !== "1", timeout: 90_000,
}, async () => {
  const output = new URL("./.cloudflare/output/v0/", import.meta.url);
  const worker = JSON.parse(readFileSync(new URL("workers/default/worker.config.json", output), "utf8"));
  assert.match(worker.name, /^effect-ci-proof-/);
  assert.deepEqual(Object.keys(worker.exports).sort(), ["RerunProof", "WorkspaceContainer"]);
  assert.deepEqual(Object.keys(worker.env ?? {}), [], "No production services, credentials or notification bindings");
  const config = JSON.parse(readFileSync(new URL(`containers/${worker.name}-workspace/container.config.json`, output), "utf8"));
  const image = JSON.parse(execFileSync("docker", ["image", "inspect", config.images.workspace.localReference], { encoding: "utf8", timeout: 10000 }))[0];
  assert.equal(image.Config.User, "node");
  assert.match(image.Id, /^sha256:[a-f0-9]{64}$/);
  for (const revision of [original, changed, programChanged]) {
    const path = mkdtempSync(join(tmpdir(), "effect-ci-native-public-"));
    try {
      chmodSync(path, 0o755); // Only public source, readable by the image's unprivileged user.
      for (const file of await publicSource(revision)) writeFileSync(join(path, file.path.split("/").at(-1)!), Buffer.from(file.base64, "base64"));
      const output = execFileSync("docker", ["run", "--rm", "--platform", "linux/amd64", "--network", "none", "--read-only", "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges", "--tmpfs", "/tmp:rw,mode=1777,size=16m",
        "--mount", `type=bind,source=${path},target=/inputs,readonly`, "--entrypoint", "bash", image.Id, "-c",
        "set -eu; mkdir /tmp/work; cp /inputs/* /tmp/work; cd /tmp/work; cp left.txt input.txt; node task.mjs leaf; cp output.txt left.txt; cp right.txt input.txt; node task.mjs leaf; cp output.txt right.txt; node task.mjs bundle; cat output.txt"],
      { encoding: "utf8", timeout: 20000 });
      assert.equal(output, revision === original ? "ALPHA / BRAVO\n" : revision === changed ? "CHARLIE / BRAVO\n" : "CHARLIE! / BRAVO!\n");
    } finally { rmSync(path, { recursive: true }); }
  }
});
