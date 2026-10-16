import { defineConfig } from "vite-plus";
import { Button } from "@cloudflare/kumo/components/button";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { URL } from "node:url";

// The tiny static demo uses Kumo's actual component and stylesheet at build time.
// No React runtime, external stylesheet request or fourth publication artifact.
const kumoStyles = readFileSync(
  new URL(import.meta.resolve("@cloudflare/kumo/styles/standalone")),
  "utf8",
);
const kumoButton = renderToStaticMarkup(
  createElement(Button, { id: "show", type: "button", variant: "secondary" }, "Test JavaScript"),
);
if (/\sstyle=/.test(kumoButton))
  throw new Error("The static Kumo button must not require CSP-blocked style attributes");

export default defineConfig({
  base: "./",
  plugins: [
    {
      name: "demo-static-kumo",
      transformIndexHtml(html) {
        if (!html.includes("<!-- kumo-styles -->") || !html.includes("<!-- kumo-button -->"))
          throw new Error("Kumo build markers are missing");
        return html
          .replace("<!-- kumo-styles -->", () => `<style>${kumoStyles}</style>`)
          .replace("<!-- kumo-button -->", () => kumoButton);
      },
    },
  ],
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
        cache: {
          // Vitest's result/timing cache is generated state, not test input.
          input: [{ auto: true }, "!.vite/**", "!node_modules/.vite/**"],
          output: [{ auto: true }, "!.vite/**", "!node_modules/.vite/**"],
        },
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
    minify: true,
  },
});
