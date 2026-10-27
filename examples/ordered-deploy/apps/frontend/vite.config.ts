import { cloudflare } from "@cloudflare/vite-plugin"
import { defineConfig } from "vite"
import { sourceRevision } from "../../src/build.ts"

export default defineConfig({
  plugins: [cloudflare()],
  define: { __SOURCE_REVISION__: JSON.stringify(sourceRevision()) },
})
