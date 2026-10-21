// Root-owned, deterministic OFF-mode proposal. No project import, plugin, model,
// credential, Git mutation, PR creation or deployment is available here.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const file = "packages/greeting/message.ts";
const prefix = "export const greeting = ";
const replacement = 'export const greeting = "Hello from a shared package.";\n';
const reject = () => Error("Modeled greeting repair rejected");
const sha = value => crypto.createHash("sha256").update(value).digest("hex");

function prepareModeledGreeting(before) {
  if (typeof before !== "string" || Buffer.byteLength(before) > 8192) throw reject();
  const source = before.trim();
  if (!source.startsWith(prefix) || !source.endsWith(";")) throw reject();
  let value;
  try { value = JSON.parse(source.slice(prefix.length, -1)); } catch { throw reject(); }
  if (typeof value !== "string" || value.trim() !== "" || source !== prefix + JSON.stringify(value) + ";") throw reject();
  return { mode: "modeled-off", path: file, beforeDigest: sha(before), afterDigest: sha(replacement), after: replacement,
    modelCalled: false, pullRequestCreated: false, deploymentPerformed: false };
}
module.exports = { prepareModeledGreeting };

if (require.main === module) {
  try {
    if (process.argv.length !== 2 && !(process.argv.length === 3 && process.argv[2] === "--verify")) throw reject();
    const root = "/workspace/repository/examples/demo";
    if (process.getuid() !== 1000 || fs.realpathSync(".") !== root) throw reject();
    for (const name of ["packages", "packages/greeting"]) {
      const stat = fs.lstatSync(name);
      if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(name) !== path.join(root, name)) throw reject();
    }
    const verify = process.argv[2] === "--verify";
    const fd = fs.openSync(file, (verify ? fs.constants.O_RDONLY : fs.constants.O_RDWR) | fs.constants.O_NOFOLLOW);
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > 8192) throw reject();
      const before = fs.readFileSync(fd, "utf8");
      if (verify) {
        if (before !== replacement) throw reject();
        console.log(JSON.stringify({ mode: "modeled-off", path: file, digest: sha(before) }));
      } else {
        const { after, ...observation } = prepareModeledGreeting(before);
        fs.writeSync(fd, after, 0, "utf8");
        fs.ftruncateSync(fd, Buffer.byteLength(after));
        console.log(JSON.stringify(observation));
      }
    } finally { fs.closeSync(fd); }
  } catch { console.error("Modeled greeting repair rejected"); process.exitCode = 1; }
}
