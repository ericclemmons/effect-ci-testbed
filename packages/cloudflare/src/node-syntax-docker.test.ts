import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  syntaxCommand,
  syntaxDockerImage,
  syntaxIdentity,
  syntaxInspectCommand,
} from "./node-syntax-check.ts";

test(
  "real immutable Linux Docker parser executes TypeScript and rejects invalid/symlink inputs without keys or network",
  {
    skip: !process.env.TEST_DOCKER_SYNTAX,
    timeout: 60_000,
  },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "effect-ci-syntax-docker-"));
    try {
      mkdirSync(join(root, "src"));
      writeFileSync(join(root, "package.json"), '{"type":"module"}');
      writeFileSync(join(root, "package-lock.json"), '{"lockfileVersion":3}');
      writeFileSync(
        join(root, "src/message.ts"),
        'import "never-link-this-module"; export const message: string = "hello"; throw new Error("must never execute");\n',
      );
      const docker = (command: string) =>
        execFileSync(
          "docker",
          [
            "run",
            "--rm",
            "--pull=never",
            "--platform=linux/amd64",
            "--network=none",
            "--read-only",
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            "--mount",
            `type=bind,source=${root},target=/inputs,readonly`,
            "--workdir=/inputs",
            "--entrypoint=/bin/sh",
            syntaxDockerImage,
            "-c",
            command,
          ],
          { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] },
        );
      const descriptor = docker(syntaxInspectCommand);
      const identity = await syntaxIdentity("a".repeat(40), descriptor);
      assert.equal(identity.kind, "check");
      assert.equal(docker(syntaxCommand), "");
      writeFileSync(join(root, "src/message.ts"), "export const = ;");
      assert.throws(
        () => docker(syntaxCommand),
        "the real Node parser must reject invalid TypeScript",
      );
      assert.notEqual(
        (await syntaxIdentity(identity.revision, docker(syntaxInspectCommand))).sourceDigest,
        identity.sourceDigest,
      );
      rmSync(join(root, "src/message.ts"));
      symlinkSync("../package.json", join(root, "src/message.ts"));
      assert.throws(() => docker(syntaxInspectCommand), "the inspector must reject symlink inputs");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
