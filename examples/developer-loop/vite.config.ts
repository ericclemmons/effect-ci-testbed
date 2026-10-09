import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      "check:source": { command: "vp check", cache: true },
      "lint:source": { command: "vp lint", cache: true },
      "typecheck:source": {
        command: "vp lint --type-aware --type-check --allow all src",
        cache: true,
      },
      "test:source": { command: "vp test", cache: true },
      "build:source": { command: "vp build", cache: true },
    },
  },
  lint: {
    ignorePatterns: ["dist/**", ".cloudflare/**"],
    rules: {
      "no-undef": "error",
    },
  },
  test: {
    include: ["src/**/*.test.js"],
  },
  build: {
    lib: {
      entry: "src/message.js",
      formats: ["es"],
      fileName: "message",
    },
    minify: false,
  },
});
