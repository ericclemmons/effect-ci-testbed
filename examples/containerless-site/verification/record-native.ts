import { mkdir, writeFile } from "node:fs/promises";
import { nativeEvidence, rejectedEvidence } from "./native.ts";
const original = await nativeEvidence("coverage-containerless-site-20261013-1");
const replay = await nativeEvidence("coverage-containerless-site-replay-20261013-1");
const rejected = rejectedEvidence();
await mkdir(new URL("../.verification/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../.verification/native-cf6dd38.json", import.meta.url),
  JSON.stringify(
    { original, replay, rejected, workerVersion: "ddf5abfa-3eb6-4bd6-bcfc-47e088dbea7e" },
    null,
    2,
  ) + "\n",
  { flag: "wx", mode: 0o600 },
);
console.log(
  "Retained native receipts written create-only. Browser/video proof is recorded separately.",
);
