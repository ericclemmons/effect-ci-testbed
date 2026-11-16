// Runnable local journey. No GitHub repository, host, deployment, or Slack writes.
import { execFileSync } from "node:child_process";
import console from "node:console";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const directory = mkdtempSync(join(tmpdir(), "effect-ci-walkthrough-"));
const project = join(directory, "app");
mkdirSync(join(project, "src"), { recursive: true });
const cli = fileURLToPath(new URL("../../../packages/cli/src/effect-ci.ts", import.meta.url));
const command = (file, args, cwd = project) => {
  const output = execFileSync(file, args, {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, AI_AGENT: "", EFFECT_CI_REMOTE_URL: "" },
  });
  writeFileSync(join(directory, `${++sequence}.log`), output);
  return output;
};
let sequence = 0;
const run = (...args) => command(process.execPath, [cli, ...args]);
const manifest = {
  name: "walkthrough-local-proof",
  private: true,
  type: "module",
  packageManager: "pnpm@12.8.1",
  scripts: { build: "vp build", typecheck: "tsc -b" },
  devDependencies: { "vite-plus": "1.6.0", typescript: "7.0.2" },
};
const saveManifest = () =>
  writeFileSync(join(project, "package.json"), JSON.stringify(manifest, null, 2));
saveManifest();
writeFileSync(join(project, ".gitignore"), "node_modules/\ndist/\n.vite/\n*.tsbuildinfo\n");
writeFileSync(
  join(project, "index.html"),
  '<div id="app"></div><script type="module" src="/src/main.ts"></script>',
);
writeFileSync(join(project, "src/main.ts"), 'document.title = "Cloudflare";');
writeFileSync(
  join(project, "tsconfig.json"),
  JSON.stringify({ compilerOptions: { noEmit: true }, include: ["src"] }),
);
writeFileSync(
  join(project, "vite.config.ts"),
  'import { defineConfig } from "vite-plus"; export default defineConfig({});',
);
command("pnpm", ["install", "--offline"]);
const discovered = JSON.parse(run("list", "--format=json"));
if (!discovered.targets.includes("build")) throw new Error("Build was not discovered");
run("plan", "build", "--format=mermaid");
// No input or output configuration: Vite+ traces the scripts' reads and writes.
run("run", "typecheck", "build", "--local", "--format=text");
const repeated = run("run", "typecheck", "build", "--local", "--format=text");
if (!/vp build ◉ cache hit/.test(repeated))
  throw new Error("Repeated build did not report a cache hit");
rmSync(join(project, "dist"), { recursive: true });
const restored = run("run", "build", "--local", "--format=text");
if (!/vp build ◉ cache hit/.test(restored) || !existsSync(join(project, "dist/index.html")))
  throw new Error("A cache hit did not restore deleted output");
writeFileSync(join(project, "src/main.ts"), 'document.title = "Effect CI";');
const changed = run("run", "build", "--local", "--format=text");
if (!/cache miss/.test(changed)) throw new Error("Changed source did not report a cache miss");

const proof = {
  project,
  logs: directory,
  discovered: discovered.targets,
  localBuild: "passed",
  repeatedBuild: "cache hit",
  deletedOutput: "restored",
  changedSource: "cache miss",
  notExercised: [
    "React/Worker starter",
    "GitHub repo/PR/checks",
    "OIDC host",
    "remote cache transport",
    "Slack",
  ],
};
writeFileSync(join(directory, "proof.json"), JSON.stringify(proof, null, 2));
console.log(JSON.stringify(proof, null, 2));
