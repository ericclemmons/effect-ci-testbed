/** THROWAWAY LOGIC PROTOTYPE. Real local Node builds, local file copies, in-memory
 * success baselines. NOT a Cloudflare deployment or implemented Workspace API.
 * Question: can a shared-package edit change deployable bytes while the app's
 * source stays unchanged, and must failed deployment keep those bytes changed?
 * Run: node examples/conditional-deploy/verification/output-changes.prototype.ts
 * Add --demo for the scripted cases; interactive mode reads one command per line.
 */
import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline/promises"
import { stdin, stdout } from "node:process"
import { assetHash, demoSite, type DemoAssets } from "../../../packages/cloudflare/src/demo-site.ts"
import { changed, initialState, transition, type Target } from "./output-state.prototype.ts"

const directory = mkdtempSync(join(tmpdir(), "effect-ci-output-prototype-"))
let state = initialState, packageVersion = 1, configVersion = 1
const entry = "import { message } from '../../packages/greeting/message.mjs'; export { message }; export const html = '<h1>' + message + '</h1>';"
const configuration = () => JSON.stringify({ servingPolicy: configVersion })
const assets = (path: string): DemoAssets => Object.fromEntries(
  ["index.html", "app.js", "message.js"].map(name => [name, readFileSync(join(path, name), "utf8")]),
) as DemoAssets
const packageFile = () => writeFileSync(join(directory, "packages/greeting/message.mjs"), `export const message = ${JSON.stringify(`package version ${packageVersion}`)};`)

mkdirSync(join(directory, "apps/site"), { recursive: true })
mkdirSync(join(directory, "packages/greeting"), { recursive: true })
writeFileSync(join(directory, "apps/site/entry.mjs"), entry)
packageFile()
writeFileSync(join(directory, "build.mjs"), `import { mkdirSync, writeFileSync } from 'node:fs';
import { html, message } from './apps/site/entry.mjs';
mkdirSync('dist',{recursive:true});writeFileSync('dist/index.html',html);
writeFileSync('dist/message.js','export const message = '+JSON.stringify(message)+';');
writeFileSync('dist/app.js','import { message } from "./message.js"; console.log(message);');`)

async function act(command: string) {
  if (command === "p") { packageVersion++; packageFile(); return }
  if (command === "c") {
    configVersion++
    state = transition(state, { type: "configured", config: await assetHash(configuration()) })
    return
  }
  if (command === "b") {
    execFileSync(process.execPath, ["build.mjs"], { cwd: directory, timeout: 10_000, env: {} })
    const site = await demoSite("a".repeat(40), assets(join(directory, "dist")))
    state = transition(state, { type: "built", output: { assets: site.digest, config: await assetHash(configuration()) } })
    return
  }
  if (!state.build) return
  const target: Target = command === "s" ? "staging" : "production"
  if (command === "f") { state = transition(state, { type: "failed-deployment", target }); return }
  if (command === "d" || command === "s") {
    if (!changed(state, target)) return
    const targetPath = join(directory, target)
    cpSync(join(directory, "dist"), targetPath, { recursive: true })
    writeFileSync(join(targetPath, "serving-policy.json"), configuration())
    const site = await demoSite("b".repeat(40), assets(targetPath))
    const output = { assets: site.digest, config: await assetHash(readFileSync(join(targetPath, "serving-policy.json"), "utf8")) }
    // Success belongs to the inspected candidate, not arbitrary copied bytes.
    if (JSON.stringify(output) !== JSON.stringify(state.build.output)) throw Error("Prototype candidate changed; rebuild before local deployment")
    state = transition(state, { type: "verified-deployment", target, output })
  }
}

function frame(label: string) {
  if (stdin.isTTY) console.clear()
  console.log(JSON.stringify({ prototype: "local only — no platform writes", action: label,
    appSourceChanged: readFileSync(join(directory, "apps/site/entry.mjs"), "utf8") !== entry,
    sharedPackageVersion: packageVersion, servingConfigVersion: configVersion,
    ...state, needsDeployment: { staging: changed(state, "staging"), production: changed(state, "production") },
  }, null, process.argv.includes("--json") ? undefined : 2))
  if (!process.argv.includes("--json")) console.log("[b] build  [p] edit shared package  [c] edit serving config  [d] deploy production locally  [f] fail production  [s] deploy staging locally  [q] quit")
}

try {
  if (process.argv.includes("--demo")) {
    for (const [command, label] of [
      ["b", "initial build"], ["d", "first production success"],
      ["p", "only shared package source edited"], ["b", "shared-package edit changes app output"],
      ["f", "deployment failure does not advance baseline"],
      ["b", "identical rebuild still needs failed deployment"], ["d", "production success"],
      ["b", "identical output from new build needs no production deployment"],
      ["s", "staging has its own success baseline"],
      ["c", "serving policy edited"], ["b", "same assets but changed deployment policy"],
    ]) { await act(command!); frame(label!) }
  } else {
    const terminal = createInterface({ input: stdin, output: stdout })
    try {
      frame("start"); stdout.write("> ")
      for await (const line of terminal) {
        const command = line.trim()
        if (command === "q") break
        await act(command); frame(command); stdout.write("> ")
      }
    } finally { terminal.close() }
  }
} finally { rmSync(directory, { recursive: true, force: true }) }
