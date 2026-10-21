// Root-owned inspector: read bytes only, never import an app module.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const fixed = require("./showcase-check-inputs.json");
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const root = fs.realpathSync(".");
if (root !== "/workspace/repository/examples/demo" || process.getuid() !== 1000)
  throw Error("Untrusted showcase workspace");
const allowed = new Set([...Object.keys(fixed).map(name => name.split("/")[0]), "packages", "node_modules", "dist",
  "README.md", ".gitignore", ".github", "tutorial", "wrangler.jsonc", ".cloudflare", ".effect-ci"]);
if (fs.readdirSync(".").some(name => !allowed.has(name))) throw Error("Unexpected showcase input");
for (const directory of ["src", "packages", "packages/greeting"]) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error("Invalid source directory");
}
for (const [directory, expected] of [["src", ["app.ts", "message.test.ts", "message.ts"]], ["packages", ["greeting"]], ["packages/greeting", ["message.ts"]]])
  if (JSON.stringify(fs.readdirSync(directory).sort()) !== JSON.stringify(expected)) throw Error("Changed showcase suite");
const paths = [...Object.keys(fixed), "packages/greeting/message.ts"].sort();
const files = paths.map(name => {
  const stat = fs.lstatSync(name);
  if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(name) !== path.join(root, name) || stat.size > 4 * 1024 * 1024)
    throw Error("Invalid source input");
  const bytes = fs.readFileSync(name), hash = sha(bytes);
  if (fixed[name] && fixed[name] !== hash) throw Error("Changed showcase test policy");
  return { path: name, size: bytes.length, sha256: hash };
});
const greeting = fs.readFileSync("packages/greeting/message.ts", "utf8").trim();
const prefix = "export const greeting = ";
if (greeting.length > 8192 || !greeting.startsWith(prefix) || !greeting.endsWith(";")) throw Error("Nonliteral greeting");
let literal;
try { literal = JSON.parse(greeting.slice(prefix.length, -1)); }
catch { throw Error("Nonliteral greeting"); }
if (typeof literal !== "string" || greeting !== prefix + JSON.stringify(literal) + ";") throw Error("Nonliteral greeting");

const dependencies = path.join(root, "node_modules");
if (fs.realpathSync(dependencies) !== dependencies) throw Error("External dependency root");
const entries = [];
let bytes = 0, visited = 0;
function walk(directory, depth) {
  if (depth > 64 || ++visited > 100_000) throw Error("Dependency traversal bound");
  for (const name of fs.readdirSync(path.join(dependencies, directory)).sort()) {
    const relative = path.posix.join(directory, name);
    if (relative === ".vite/vitest" || relative === ".vite/task-cache") continue;
    const file = path.join(dependencies, relative), stat = fs.lstatSync(file);
    if (entries.length > 100_000) throw Error("Dependency entry bound");
    if (stat.isSymbolicLink()) {
      if (!fs.realpathSync(file).startsWith(dependencies + "/")) throw Error("External dependency link");
      entries.push([relative, "link", fs.readlinkSync(file)]);
    } else if (stat.isDirectory()) walk(relative, depth + 1);
    else if (stat.isFile()) {
      bytes += stat.size;
      if (bytes > 1024 * 1024 * 1024) throw Error("Dependency byte bound");
      entries.push([relative, stat.mode & 0o777, stat.size, sha(fs.readFileSync(file))]);
    } else throw Error("Special dependency file");
  }
}
walk("", 0);
console.log(JSON.stringify({ version: 1, uid: process.getuid(), files,
  dependencies: sha(JSON.stringify(entries)), dependencyFiles: entries.length,
  node: sha(fs.readFileSync(process.execPath)), runtime: process.version, platform: process.platform, arch: process.arch }));
