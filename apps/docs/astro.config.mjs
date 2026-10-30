import { defineConfig } from "astro/config"
import { unified } from "@astrojs/markdown-remark"
import starlight from "@astrojs/starlight"
import { repository, repositoryMarkdown, root, sidebar } from "./src/repository.mjs"

export default defineConfig({
  site: "https://effect-ci-docs.eclemmons.workers.dev",
  markdown: { processor: unified({ remarkPlugins: [repositoryMarkdown] }) },
  integrations: [starlight({
    title: "Effect CI",
    description: "CI experiments by Eric Clemmons.",
    social: [{ icon: "github", label: "GitHub", href: repository }],
    sidebar: sidebar(),
    components: { Head: "./src/components/Head.astro", MarkdownContent: "./src/components/MarkdownContent.astro" },
  })],
  vite: { server: { fs: { allow: [root] } } },
})
