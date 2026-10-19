/** LOCAL-only, create-only dedicated webhook secret. Never run inside a Worker. */
import { randomBytes } from "node:crypto";
import { lstat, mkdir, open } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const directory = new URL("../.verification", import.meta.url);
await mkdir(directory, { recursive: true, mode: 0o700 });
if ((await lstat(directory)).isSymbolicLink())
  throw new Error("Secret directory must not be a symlink");
const target = new URL("notifications-secret.json", directory);
const file = await open(target, "wx", 0o600);
try {
  await file.writeFile(
    JSON.stringify({ NOTIFICATIONS_SECRET: randomBytes(32).toString("hex") }) +
      "\n",
  );
} finally {
  await file.close();
}
console.log(
  `Created dedicated local secret: ${fileURLToPath(target)} (value not displayed).`,
);
