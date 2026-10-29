import { cloudflare } from "@cloudflare/vite-plugin"
import { defineConfig } from "vite"
import { prepareStandaloneRuntime } from "./standalone-runtime.ts"

export default defineConfig({
  plugins: [{
    name: "effect-ci-standalone-runtime",
    configResolved() { prepareStandaloneRuntime() },
  }, cloudflare(), {
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
