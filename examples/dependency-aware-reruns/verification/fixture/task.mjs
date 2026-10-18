import { readFileSync, writeFileSync } from "node:fs";

if (process.argv[2] === "bundle") {
  writeFileSync("output.txt", ["left.txt", "right.txt"].map(path => readFileSync(path, "utf8").trim()).join(" / ") + "\n");
} else {
  writeFileSync("output.txt", readFileSync("input.txt", "utf8").trim().toUpperCase() + "!\n");
}
