import { defineConfig } from "vite-plus"

export default defineConfig({
  lint: {
    ignorePatterns: ["dist/**", ".cloudflare/**"],
    rules: {
      "no-undef": "error",
    },
  },
  build: {
    lib: {
      entry: "app/message.js",
      formats: ["es"],
      fileName: "message",
    },
    minify: false,
  },
})
