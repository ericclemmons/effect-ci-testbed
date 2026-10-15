import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

const ciRoot = fileURLToPath(new URL("./.cloudflare/ci/", import.meta.url));
export default defineConfig({
  plugins: [{
    name: "own-committed-ci-modules",
    // Internal build imports only. Keep the plugin's HTTP .cloudflare denial.
    async load(id) {
      if (id.startsWith(ciRoot) && /^[\w/-]+\.ts$/.test(id.slice(ciRoot.length))) return readFile(id, "utf8");
    },
  }, cloudflare()],
});
