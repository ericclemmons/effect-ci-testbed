import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { cloudflare } from "@cloudflare/vite-plugin"
import { defineConfig } from "vite"

const examplesRoot = fileURLToPath(new URL("../../examples/", import.meta.url))

export default defineConfig({
  plugins: [
    {
      name: "trusted-example-workflows",
      // Cloudflare's plugin denies .cloudflare directories over HTTP. Load only
      // committed CI TypeScript modules internally; retain all HTTP deny rules.
      async load(id) {
        if (id.startsWith(examplesRoot) && /\/\.cloudflare\/ci\/[\w/-]+\.ts$/.test(id)) {
          return readFile(id, "utf8")
        }
      },
    },
    cloudflare(),
  ],
})
