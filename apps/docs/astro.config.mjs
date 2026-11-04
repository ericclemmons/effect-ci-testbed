import { defineConfig } from "astro/config"
import tailwindcss from "@tailwindcss/vite"
import nimbus, { defineConfig as defineNimbusConfig } from "@cloudflare/nimbus-docs"
import { repository, root, sidebar } from "./src/repository.mjs"

export default defineConfig({
  output: "static",
  prefetch: { prefetchAll: true, defaultStrategy: "hover" },
  integrations: [nimbus(defineNimbusConfig({
    site: "https://effect-ci-docs.eclemmons.workers.dev",
    title: "Effect CI",
    description: "Write CI once. Run it locally, on GitHub, or on Cloudflare.",
    github: repository,
    sidebar: { items: sidebar() },
  }))],
  vite: { plugins: [tailwindcss()], server: { fs: { allow: [root] } } },
})
