import { defineConfig } from "vite-plus"

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: "node scripts/build.mjs",
        cache: {
          input: ["src/**", "scripts/build.mjs", "vite.config.ts"],
          output: ["dist/**"],
        },
      },
    },
  },
})
