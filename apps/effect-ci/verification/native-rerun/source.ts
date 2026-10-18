export const repository = "https://github.com/ericclemmons/effect-ci-testbed";
export const sourceRoot = "examples/dependency-aware-reruns/verification/fixture";
export const original = "9035c3ea82466202d535f3544c2dcb314eb5b99e";
export const changed = "2e1ce575388c64fd0f60a94c012a85d7362f42c0";
export const programChanged = "9bf397572cf7aaf5f5754f3ab4ab130cfa483a23";
const objects: Record<string, Record<string, string>> = {
  [original]: { "left.txt": "4a58007052a65fbc2fc3f910f2855f45a4058e74", "right.txt": "652d57d3037e10eb2fe1f603effc036e94e59c1c", "task.mjs": "0095fbccd0088d48751587e65642120d4c5b3249" },
  [changed]: { "left.txt": "7e5ac7112f1bef9d3bbefe883a8a8441aae3c36a", "right.txt": "652d57d3037e10eb2fe1f603effc036e94e59c1c", "task.mjs": "0095fbccd0088d48751587e65642120d4c5b3249" },
  [programChanged]: { "left.txt": "7e5ac7112f1bef9d3bbefe883a8a8441aae3c36a", "right.txt": "652d57d3037e10eb2fe1f603effc036e94e59c1c", "task.mjs": "fc96c946e6f46bc373e56e18699fe4b0f2017d90" },
};

// Fetch only three public blobs, not the entire repository/history in every VM.
// The build-reviewed Git object IDs bind the bytes to the fixed source commits.
export async function publicSource(revision: string, request: typeof fetch = fetch) {
  if (!Object.hasOwn(objects, revision)) throw Error("Unapproved fixture source revision");
  const files = [];
  for (const [name, expected] of Object.entries(objects[revision]!)) {
    const response = await request(`https://raw.githubusercontent.com/ericclemmons/effect-ci-testbed/${revision}/${sourceRoot}/${name}`, {
      redirect: "manual", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok || !response.body) throw Error("Public fixture source unavailable");
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if ((size += value.length) > 16_384) throw Error("Public fixture source too large");
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => undefined); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const prefix = new TextEncoder().encode(`blob ${size}\0`), gitObject = new Uint8Array(prefix.length + size);
    gitObject.set(prefix); gitObject.set(bytes, prefix.length);
    const actual = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", gitObject)), n => n.toString(16).padStart(2, "0")).join("");
    if (actual !== expected) throw Error("Public fixture Git blob mismatch");
    files.push({ path: `${sourceRoot}/${name}`, base64: btoa(String.fromCharCode(...bytes)), executable: false });
  }
  return files;
}
