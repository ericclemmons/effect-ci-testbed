import { execFileSync } from "node:child_process";
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { hostedCheckBytes } from "./check-evidence.ts";
import {
  syntaxCommand,
  syntaxDockerImage,
  syntaxIdentity,
  syntaxInspectCommand,
  syntaxKeyId,
  syntaxPaths,
  syntaxPublicKey,
  syntaxRepository,
  syntaxRoot,
} from "./node-syntax-check.ts";

/** Local-only signer for one enrolled parse-only check. No secret enters Docker. */
export const attestDemoSyntax = async () => {
  const git = (...args: string[]) =>
    execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const repository = git("config", "--get", "remote.origin.url")
    .replace(/^git@github.com:/, "https://github.com/")
    .replace(/\.git$/, "");
  if (repository !== syntaxRepository || git("status", "--porcelain", "--untracked-files=normal")) {
    throw new Error("Syntax attestation requires a clean, committed enrolled repository");
  }
  const revision = git("rev-parse", "HEAD");
  const ref = "refs/notes/effect-ci-hosted-checks-v1";
  let existing = false;
  try {
    git("notes", `--ref=${ref}`, "show", revision);
    existing = true;
  } catch {}
  if (existing) throw new Error("An existing exact-commit note must not be overwritten");
  const root = git("rev-parse", "--show-toplevel");
  const snapshot = mkdtempSync(join(tmpdir(), "effect-ci-syntax-source-"));
  // Only public committed inputs, no .git, dependencies or current working files.
  const cwd = join(snapshot, syntaxRoot);
  for (const path of syntaxPaths) {
    const target = join(cwd, path);
    mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
    writeFileSync(target, execFileSync("git", ["show", `${revision}:${syntaxRoot}/${path}`]), {
      flag: "wx",
      mode: 0o644,
    });
  }
  // Docker sees only this public snapshot, never the signer directory or env.
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
        "--pids-limit=64",
        "--memory=256m",
        "--cpus=1",
        "--mount",
        `type=bind,source=${snapshot},target=/workspace/repository,readonly`,
        "--workdir",
        `/workspace/repository/${syntaxRoot}`,
        "--entrypoint=/bin/sh",
        syntaxDockerImage,
        "-c",
        command,
      ],
      {
        encoding: "utf8",
        timeout: 60_000,
        maxBuffer: 65_536,
        stdio: ["ignore", "pipe", "pipe"],
        env: Object.fromEntries(
          ["PATH", "HOME", "TMPDIR", "DOCKER_HOST", "DOCKER_CONTEXT"]
            .filter((key) => process.env[key] !== undefined)
            .map((key) => [key, process.env[key]!]),
        ),
      },
    );
  const descriptor = docker(syntaxInspectCommand);
  const identity = await syntaxIdentity(revision, descriptor);
  docker(syntaxCommand); // A nonzero parse result throws before key access or note creation.
  if (
    git("rev-parse", "HEAD") !== revision ||
    git("status", "--porcelain", "--untracked-files=normal")
  ) {
    throw new Error("Source changed during exact-commit execution");
  }
  const keyPath = join(homedir(), ".config/effect-ci/signers/demo-node-syntax-v1.pem");
  const info = lstatSync(keyPath);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    (info.mode & 0o077) !== 0 ||
    info.uid !== process.getuid?.()
  ) {
    throw new Error("The enrolled signer must remain a private user-owned local file");
  }
  const key = createPrivateKey(readFileSync(keyPath));
  if (createPublicKey(key).export({ format: "jwk" }).x !== syntaxPublicKey.x)
    throw new Error("Signer is not enrolled");
  const note = JSON.stringify({
    version: 1,
    keyId: syntaxKeyId,
    identity,
    signature: Buffer.from(sign(null, hostedCheckBytes(identity), key)).toString("base64url"),
  });
  const receiptDirectory = join(root, syntaxRoot, ".verification");
  mkdirSync(receiptDirectory, { recursive: true, mode: 0o700 });
  const path = join(receiptDirectory, `syntax-${revision}-${Date.now()}.json`);
  writeFileSync(
    path,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        identity,
        descriptor: JSON.parse(descriptor),
        image: syntaxDockerImage,
        command: syntaxCommand,
        exitCode: 0,
        note,
        snapshot,
        boundary:
          "Local Linux Docker parse-only execution; private key outside container; not a hosted hit or action bypass",
      },
      null,
      2,
    ),
    { flag: "wx", mode: 0o600 },
  );
  execFileSync("git", ["notes", `--ref=${ref}`, "add", "-F", "-", revision], {
    input: note,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return { revision, keyId: syntaxKeyId, command: syntaxCommand, receipt: path, notesRef: ref };
};
