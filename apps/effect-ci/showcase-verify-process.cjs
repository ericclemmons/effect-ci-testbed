// Readiness runs through the same restriction prefix as every project command.
// Never import project code or treat a claimed uid as evidence of isolation.
const fs = require("node:fs");
const status = Object.fromEntries(fs.readFileSync("/proc/self/status", "utf8").split("\n").flatMap(line => {
  const colon = line.indexOf(":");
  return colon < 0 ? [] : [[line.slice(0, colon), line.slice(colon + 1).trim()]];
}));
const capabilityFields = ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"];
if (process.getuid() !== 1000 || process.getgid() !== 1000 || process.getgroups().some(gid => gid !== 1000) ||
    status.NoNewPrivs !== "1" || capabilityFields.some(name => !status[name] || BigInt("0x" + status[name]) !== 0n))
  throw Error("Showcase process privileges are not restricted");
