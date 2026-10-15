import { defineConfig } from "vite-plus";

export default defineConfig({
  base: "./",
  run: {
    tasks: {
      "check:source": { command: "vp check", cache: true },
      "lint:source": { command: "vp lint", cache: true },
      "typecheck:source": {
        command: "vp lint --type-aware --type-check --allow all src",
        cache: true,
      },
      "test:source": {
        command: "vp test && node --test verification/*.test.mjs verification/*.test.ts",
        cache: true,
      },
      "build:source": { command: "vp build", cache: true },
    },
  },
  lint: {
    ignorePatterns: ["dist/**", ".cloudflare/**"],
    overrides: [{ files: ["src/app.ts"], env: { browser: true } }],
    rules: {
      "no-undef": "error",
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
  build: {
    rolldownOptions: {
      input: { app: "index.html", message: "src/message.ts" },
      preserveEntrySignatures: "strict",
      output: { entryFileNames: "[name].js" },
    },
    minify: false,
  },
});
