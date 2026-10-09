import { defineConfig } from "vite-plus"

export default defineConfig({
  build: {
    lib: {
      entry: "app/message.js",
      formats: ["es"],
      fileName: "message",
    },
    minify: false,
  },
})
