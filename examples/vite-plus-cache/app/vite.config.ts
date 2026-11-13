import { defineConfig } from "vite-plus"

export default defineConfig({
  run: {
    tasks: {
      build: { command: "node scripts/build.ts" },
    },
  },
})
