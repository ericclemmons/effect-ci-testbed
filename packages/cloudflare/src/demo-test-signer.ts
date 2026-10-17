import { execFileSync } from "node:child_process";
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { hostedCheckBytes } from "./check-evidence.ts";
import {
  testCommand,
  testIdentity,
  testImage,
  testInspectCommand,
  testKeyId,
  testNotesRef,
  testPaths,
  testPublicKey,
  testRepository,
  testRoot,
} from "./demo-test-check.ts";

/** Exact-commit Vitest signer. Docker receives only public committed inputs;
 * the existing operator key is read locally only after successful execution. */
export async function attestDemoTests() {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const clean = () => !git("status", "--porcelain", "--untracked-files=normal");
  const repository = git("config", "--get", "remote.origin.url")
    .replace(/^git@github.com:/, "https://github.com/")
    .replace(/\.git$/, "");
  if (repository !== testRepository || !clean())
    throw Error("Test attestation requires the clean committed enrolled repository");
  const revision = git("rev-parse", "HEAD");
  let existing = false;
  try {
    git("notes", `--ref=${testNotesRef}`, "show", revision);
    existing = true;
  } catch {}
  if (existing) throw Error("An exact-commit test note already exists; never overwrite it");
  const sourcePaths = git("ls-tree", "-r", "--name-only", revision, "--", `${testRoot}/src`).split(
    "\n",
  );
  if (
    JSON.stringify(sourcePaths) !==
    JSON.stringify(testPaths.filter((p) => p.startsWith("src/")).map((p) => `${testRoot}/${p}`))
  )
    throw Error("Changed demo suite");
  const snapshot = mkdtempSync(join(tmpdir(), "effect-ci-test-attest-"));
  for (const path of testPaths) {
    const object = `${revision}:${testRoot}/${path}`;
    if (!git("ls-tree", revision, `${testRoot}/${path}`).startsWith("100644 blob "))
      throw Error("Nonregular committed test input");
    const target = join(snapshot, testRoot, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, execFileSync("git", ["show", object], { cwd: root }), { flag: "wx", mode: 0o644 });
  }
  const docker = (command: string, network: "none" | "bridge") =>
    execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "--pull=never",
        "--platform=linux/amd64",
        `--network=${network}`,
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--pids-limit=256",
        "--memory=2g",
        "--cpus=2",
        "--mount",
        `type=bind,source=${snapshot},target=/workspace/repository`,
        "--workdir",
        `/workspace/repository/${testRoot}`,
        "--entrypoint=/bin/sh",
        testImage,
        "-c",
        command,
      ],
      {
        encoding: "utf8",
        timeout: 180000,
        maxBuffer: 262144,
        stdio: ["ignore", "pipe", "pipe"],
        env: Object.fromEntries(
          ["PATH", "HOME", "TMPDIR", "DOCKER_HOST", "DOCKER_CONTEXT"]
            .filter((k) => process.env[k] !== undefined)
            .map((k) => [k, process.env[k]!]),
        ),
      },
    );
  // Public pinned dependencies only. No host npm config, auth, .git or key mount.
  docker(
    "env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp npm_config_cache=/tmp/npm npm ci",
    "bridge",
  );
  const descriptor = docker(testInspectCommand, "none"),
    identity = await testIdentity(revision, descriptor);
  const output = docker(testCommand, "none"); // Nonzero throws before key access and note creation.
  const after = await testIdentity(revision, docker(testInspectCommand, "none"));
  if (
    JSON.stringify(after) !== JSON.stringify(identity) ||
    git("rev-parse", "HEAD") !== revision ||
    !clean()
  )
    throw Error("Inputs changed during test execution");
  const keyPath = join(homedir(), ".config/effect-ci/signers/demo-node-syntax-v1.pem"),
    info = lstatSync(keyPath);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    (info.mode & 0o077) !== 0 ||
    info.uid !== process.getuid?.()
  )
    throw Error("Signer must remain a private local user-owned file");
  const key = createPrivateKey(readFileSync(keyPath));
  if (createPublicKey(key).export({ format: "jwk" }).x !== testPublicKey.x)
    throw Error("Signer is not enrolled");
  const note = JSON.stringify({
    version: 1,
    keyId: testKeyId,
    identity,
    signature: Buffer.from(sign(null, hostedCheckBytes(identity), key)).toString("base64url"),
  });
  const receiptDirectory = join(root, testRoot, ".verification");
  mkdirSync(receiptDirectory, { recursive: true, mode: 0o700 });
  const receipt = join(receiptDirectory, `tests-${revision}-${Date.now()}.json`);
  writeFileSync(
    receipt,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        identity,
        descriptor: JSON.parse(descriptor),
        image: testImage,
        command: testCommand,
        exitCode: 0,
        output,
        note,
        snapshot,
        boundary:
          "Actual networkless Linux Vitest suite; typecheck not attested; private key outside Docker; not yet a hosted cache hit",
      },
      null,
      2,
    ),
    { flag: "wx", mode: 0o600 },
  );
  execFileSync("git", ["notes", `--ref=${testNotesRef}`, "add", "-F", "-", revision], {
    cwd: root,
    input: note,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return { revision, keyId: testKeyId, command: testCommand, receipt, notesRef: testNotesRef };
}
