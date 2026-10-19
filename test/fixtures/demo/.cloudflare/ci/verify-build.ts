import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const paths = ["dist/index.html", "dist/app.js", "dist/message.js"];

/** Inspect this action's inherited build output; no manifest, export, cache or restore API. */
export function verifyBuild(directory = process.cwd()) {
  const root = realpathSync(directory);
  let total = 0;
  const files = paths.map((path) => {
    const absolute = join(root, path);
    const info = lstatSync(absolute);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      realpathSync(absolute) !== absolute ||
      info.size === 0 ||
      info.size > 256 * 1024
    ) {
      throw new Error("Build output must contain bounded regular files");
    }
    const bytes = readFileSync(absolute);
    total += bytes.length;
    if (total > 512 * 1024) throw new Error("Build output exceeds its byte limit");
    return { path, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  });
  return { verified: true, files };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(verifyBuild()));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Build output verification failed");
    process.exitCode = 1;
  }
}
