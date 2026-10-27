import { execFile } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { promisify } from "node:util"
import { decodeSourceManifest } from "../packages/cloudflare/src/source-manifest.ts"
import { sourceIdentity } from "./coverage-receipt.ts"

const execute = promisify(execFile)
const [provider] = process.argv.slice(2)
if (provider !== "r2" && provider !== "durable-object") throw Error("Choose r2 or durable-object")
const revision = provider === "r2"
  ? "6759fef7f59ccbd363fb8c42062fb4903d98070d08da56c6ae873d9a75ea41cd"
  : "c79e699009991bf593f593ae81b03241c6de16447d4598ba66bee96d8b2eeed9"
const expected = provider === "r2" ? "source from r2\n" : "source from durable object\n"
const directory = await mkdtemp(join(tmpdir(), "effect-ci-conventional-source-"))
const container = `effect-ci-source-${randomUUID()}`
let launched = false
try {
  const url = new URL(process.env.SOURCE_MANIFEST_URL ?? "")
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw Error("HTTPS manifest capability required")
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000) })
  if (response.status !== 200 || !response.body) throw Error("Source capability did not return a manifest")
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.byteLength
    if (size > 96 * 1024) {
      throw Error("Source manifest byte limit exceeded")
    }
    chunks.push(chunk)
  }
  const files = await decodeSourceManifest(Buffer.concat(chunks), revision)
  if (files.length !== 1 || files.some(file => file.path !== "source.txt" || file.executable ||
    Buffer.from(file.base64, "base64").toString("utf8") !== expected)) throw Error("Wrong owned source fixture")
  for (const file of files) {
    const target = join(directory, file.path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, Buffer.from(file.base64, "base64"), { flag: "wx", mode: 0o444 })
  }
  await chmod(directory, 0o755)
  const image = process.env.SOURCE_COMPARISON_IMAGE ?? "node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53"
  const metadata = await execute("docker", ["image", "inspect", image, "--format", "{{json .}}"])
  const inspected = JSON.parse(metadata.stdout)
  const expectedDigest = createHash("sha256").update(expected).digest("hex")
  launched = true
  const result = await execute("docker", [
    "run", "--rm", "--name", container, "--pull=never", "--network=none", "--read-only", "--cap-drop=ALL",
    "--security-opt=no-new-privileges", "--user", "65534:65534", "--volume", `${directory}:/input:ro`,
    inspected.Id, "node", "--input-type=module", "-e",
    `import { readFileSync } from "node:fs"; import { createHash } from "node:crypto";
const bytes = readFileSync("/input/source.txt");
if (createHash("sha256").update(bytes).digest("hex") !== "${expectedDigest}") throw Error("Wrong source bytes");
if (Object.keys(process.env).some(name => /AWS|R2_|CLOUDFLARE|TOKEN|SECRET|SOURCE_/.test(name))) throw Error("Storage credential in workload");
console.log(JSON.stringify({ verified: true, bytes: bytes.length, storageCredentialsPresent: false }));`,
  ], { timeout: 30_000 })
  const receipt = {
    schemaVersion: 1, recordedAt: new Date().toISOString(),
    recipe: provider + "-source", environment: process.env.GITHUB_ACTIONS === "true" ? "conventional-github" : "conventional-local",
    source: sourceIdentity(process.cwd(), ["examples/source-comparison.ts", "examples/coverage-receipt.ts", "packages/cloudflare/src/source-manifest.ts"]),
    github: process.env.GITHUB_RUN_ID ? { runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT } : null,
    input: { requestedProvider: provider, revision, bytes: size, files: files.length, issuerReceipt: null },
    image: { id: inspected.Id, digests: inspected.RepoDigests }, workload: JSON.parse(result.stdout),
    boundary: "Host fetches a scoped HTTPS capability; guest receives only validated files, no network or input credential. Provider provenance needs the separately approved issuer receipt.",
  }
  if (process.env.SOURCE_COMPARISON_RECEIPT) await writeFile(process.env.SOURCE_COMPARISON_RECEIPT, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" })
  console.log(JSON.stringify(receipt))
} catch {
  throw Error("Conventional source comparison failed; URL, response and provider errors withheld")
} finally {
  try {
    if (launched) await execute("docker", ["rm", "--force", container]).catch(error => {
      if (!String(error.stderr).includes("No such container")) throw Error("Conventional workload cleanup failed")
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
