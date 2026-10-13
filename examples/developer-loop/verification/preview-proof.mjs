import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import console from "node:console";
import { createPreview } from "./page.mjs";

if (process.argv.length !== 3)
  throw new Error("Usage: npm run proof:preview -- <recorded-run-UUID>");
console.log(createPreview(fileURLToPath(new URL("../", import.meta.url)), process.argv[2]));
