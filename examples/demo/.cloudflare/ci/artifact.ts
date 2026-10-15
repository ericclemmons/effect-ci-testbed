import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const artifactPaths = ["dist/index.html", "dist/app.js", "dist/message.js"] as const;
export const manifestPath = ".effect-ci/artifacts/demo-build.json";
const fileLimit = 2 * 1024 * 1024;
const totalLimit = 4 * 1024 * 1024;
type FileIdentity = { path: string; size: number; sha256: string };
type Manifest = { version: 1; name: "demo-build"; files: FileIdentity[] };

function regular(root: string, path: string, limit: number) {
  const absolute = join(root, path);
  const info = lstatSync(absolute);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    realpathSync(absolute) !== absolute ||
    info.size === 0 ||
    info.size > limit
  ) {
    throw new Error("Artifact requires bounded regular files inside this workspace");
  }
  return readFileSync(absolute);
}

function identities(root: string): FileIdentity[] {
  let total = 0;
  return artifactPaths.map((path) => {
    const bytes = regular(root, path, fileLimit);
    total += bytes.length;
    if (total > totalLimit) throw new Error("Artifact exceeds total byte limit");
    return { path, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  });
}

function parseManifest(bytes: Buffer): Manifest {
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (
    !value ||
    value.version !== 1 ||
    value.name !== "demo-build" ||
    Object.keys(value).sort().join() !== "files,name,version" ||
    !Array.isArray(value.files) ||
    value.files.length !== 3 ||
    !value.files.every(
      (file: any, index: number) =>
        file &&
        Object.keys(file).sort().join() === "path,sha256,size" &&
        file.path === artifactPaths[index] &&
        Number.isInteger(file.size) &&
        file.size > 0 &&
        file.size <= fileLimit &&
        /^[a-f0-9]{64}$/.test(file.sha256),
    )
  ) {
    throw new Error("Invalid demo build manifest");
  }
  return value;
}

/** Ordinary generated build metadata, not signed evidence or cache authority. */
export function writeBuildManifest(directory = process.cwd()) {
  const root = realpathSync(directory);
  const manifest: Manifest = { version: 1, name: "demo-build", files: identities(root) };
  for (const path of [".effect-ci", ".effect-ci/artifacts"]) {
    const absolute = join(root, path);
    if (!existsSync(absolute)) mkdirSync(absolute, { mode: 0o700 });
    const info = lstatSync(absolute);
    if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(absolute) !== absolute) {
      throw new Error("Artifact metadata directory must remain inside this workspace");
    }
  }
  const target = join(root, manifestPath);
  // Replace only this tool's generated metadata, never an unknown file or link.
  try {
    parseManifest(regular(root, manifestPath, 8192));
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  const temporary = join(dirname(target), `demo-build-${randomUUID()}.tmp`);
  writeFileSync(temporary, JSON.stringify(manifest) + "\n", { flag: "wx", mode: 0o600 });
  renameSync(temporary, target);
  return manifest;
}

export function verifyBuildManifest(directory = process.cwd()) {
  const root = realpathSync(directory);
  const manifest = parseManifest(regular(root, manifestPath, 8192));
  if (JSON.stringify(manifest.files) !== JSON.stringify(identities(root))) {
    throw new Error("Restored artifact bytes do not match the published manifest");
  }
  return { ...manifest, verified: true };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const mode = process.argv[2];
    if (mode !== "create" && mode !== "verify") throw new Error("Usage: artifact.ts create|verify");
    console.log(JSON.stringify(mode === "create" ? writeBuildManifest() : verifyBuildManifest()));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Artifact verification failed");
    process.exitCode = 1;
  }
}
