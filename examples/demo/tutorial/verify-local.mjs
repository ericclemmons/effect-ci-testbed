// Runnable local journey. No GitHub repository, host, deployment, or Slack writes.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = mkdtempSync(join(tmpdir(), "effect-ci-walkthrough-"));
const project = join(directory, "app");
mkdirSync(join(project, "src"), { recursive: true });
const cli = fileURLToPath(new URL("../../../packages/cli/src/effect-ci.ts", import.meta.url));
const command = (file, args, cwd = project) => {
  const output = execFileSync(file, args, { cwd, encoding: "utf8", timeout: 120_000,
    env: { ...process.env, AI_AGENT: "", EFFECT_CI_REMOTE_URL: "" } });
  writeFileSync(join(directory, `${++sequence}.log`), output);
  return output;
};
let sequence = 0;
const run = (...args) => command(process.execPath, [cli, ...args]);
const manifest = {
  name: "walkthrough-local-proof", private: true, type: "module",
  packageManager: "pnpm@12.8.1",
  scripts: { build: "tsc -b && vp build" },
  devDependencies: { "vite-plus": "1.0.0", typescript: "7.0.2" },
};
const saveManifest = () => writeFileSync(join(project, "package.json"), JSON.stringify(manifest, null, 2));
saveManifest();
writeFileSync(join(project, ".gitignore"), "node_modules/\ndist/\n.vite/\n*.tsbuildinfo\n");
writeFileSync(join(project, "index.html"), '<div id="app"></div><script type="module" src="/src/main.ts"></script>');
writeFileSync(join(project, "src/main.ts"), 'document.title = "Cloudflare";');
writeFileSync(join(project, "tsconfig.json"), JSON.stringify({ compilerOptions: { noEmit: true }, include: ["src"] }));
writeFileSync(join(project, "vite.config.ts"), 'import { defineConfig } from "vite-plus"; export default defineConfig({});');
command("pnpm", ["install", "--offline"]);
const discovered = JSON.parse(run("list", "--format=json"));
if (!discovered.targets.includes("build")) throw new Error("Build was not discovered");
run("plan", "build", "--format=mermaid");
run("run", "build", "--local", "--format=text");

delete manifest.scripts.build;
saveManifest();
writeFileSync(join(project, "vite.config.ts"), 'import { defineConfig } from "vite-plus";\n'
  + readFileSync(new URL("cache-task.ts", import.meta.url), "utf8")
  + '\nexport default defineConfig({ run: cachedBuild });\n');
run("run", "build", "--local", "--format=text");
const repeated = run("run", "build", "--local", "--format=text");
if (!/cache hit/.test(repeated)) throw new Error("Repeated build did not report a cache hit");
writeFileSync(join(project, "src/main.ts"), 'document.title = "Effect CI";');
const changed = run("run", "build", "--local", "--format=text");
if (!/cache miss/.test(changed)) throw new Error("Changed source did not report a cache miss");

// Ephemeral identity verifies Git signing locally; it is not a GitHub verified identity.
const key = join(directory, "signing");
command("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key]);
const git = (...args) => command("git", args);
git("init", "-q");
git("config", "user.name", "Walkthrough local proof");
git("config", "user.email", "walkthrough@example.invalid");
git("config", "gpg.format", "ssh");
git("config", "user.signingkey", key);
git("add", ".");
git("commit", "-S", "-qm", "feat: Build the walkthrough app");
const signers = join(directory, "allowed-signers");
writeFileSync(signers, `walkthrough@example.invalid ${readFileSync(`${key}.pub`, "utf8")}`);
git("-c", `gpg.ssh.allowedSignersFile=${signers}`, "verify-commit", "HEAD");
const proof = {
  project, logs: directory, discovered: discovered.targets,
  localBuild: "passed", repeatedBuild: "cache hit", changedSource: "cache miss",
  commitSignature: "verified locally with an ephemeral key",
  notExercised: ["React/Worker starter", "GitHub repo/PR/checks", "OIDC host", "remote cache transport", "Slack"],
};
writeFileSync(join(directory, "proof.json"), JSON.stringify(proof, null, 2));
console.log(JSON.stringify(proof, null, 2));
