import { defineConfig } from "astro/config"
import { unified } from "@astrojs/markdown-remark"
import starlight from "@astrojs/starlight"
import { repository, repositoryMarkdown, root, sidebar } from "./src/repository.mjs"

export default defineConfig({
  site: "https://effect-ci-docs.ericclemmons.workers.dev",
  markdown: { processor: unified({ remarkPlugins: [repositoryMarkdown] }) },
  integrations: [starlight({
    title: "Effect CI",
    description: "Portable CI workflows, demonstrated by runnable examples.",
    social: [{ icon: "github", label: "GitHub", href: repository }],
    sidebar: sidebar(),
    components: { Head: "./src/components/Head.astro" },
  })],
  vite: { server: { fs: { allow: [root] } } },
})
