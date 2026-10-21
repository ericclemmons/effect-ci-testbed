// Root-owned image code. Never load a module or configuration from the app.
const fs = require("node:fs");
const path = require("node:path");
const expected = ["app.js", "index.html", "message.js"];
if (process.getuid() !== 1000) throw Error("Untrusted build verifier uid");
const directory = fs.lstatSync("dist");
if (!directory.isDirectory() || directory.isSymbolicLink()) throw Error("Invalid build directory");
if (JSON.stringify(fs.readdirSync("dist").sort()) !== JSON.stringify(expected))
  throw Error("Build assets do not match the hosted publication contract");
for (const name of expected) {
  const file = fs.lstatSync(path.join("dist", name));
  if (!file.isFile() || file.isSymbolicLink() || file.size < 1 || file.size > 2 * 1024 * 1024)
    throw Error("Invalid build asset");
}
