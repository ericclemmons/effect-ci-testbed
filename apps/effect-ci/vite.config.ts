import { cloudflare } from "@cloudflare/vite-plugin"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [cloudflare(), {
    name: "effect-ci-workflow-source",
    enforce: "post",
    config(config) {
      // The CF plugin denies all .cloudflare files. ci/ is authored source,
      // not generated state. Keep every other deny (especially secrets).
      const fs = config.server?.fs;
      if (fs?.deny) fs.deny = fs.deny.map(pattern => pattern === "**/.cloudflare/**"
        ? "**/.cloudflare/!(ci){,/**}" : pattern);
    },
  }],
})
