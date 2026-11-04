import { resolve, relative } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { Loader } from "astro/loaders"
import { dependencies, pages, repository, root } from "./repository.mjs"

export function readmes(): Loader {
  return {
    name: "collocated-readmes",
    async load({ config, store, parseData, renderMarkdown, watcher, logger }) {
      let watched = new Set<string>()
      async function sync() {
        const documents = pages()
        store.clear()
        watched = new Set(documents.flatMap(dependencies))
        watcher?.add([...watched])
        for (const page of documents) {
          const data = await parseData({ id: page.id, data: {
            title: page.title,
            pagefind: page.id !== "examples/demo",
            ...(page.id === "index" ? {} : { banner: { content: "<strong>Prototype.</strong> CI experiments by Eric Clemmons." } }),
            editUrl: `${repository}/edit/main/${page.path}`,
          } })
          let body = page.body.replace(/^# .+\r?\n/m, "")
          if (page.id === "index") body = body.replace(/^## Features\n[\s\S]*?(?=^## )/m, "")
          const filePath = resolve(root, page.path)
          store.set({ id: page.id, data, body, filePath: relative(fileURLToPath(config.root), filePath),
            rendered: await renderMarkdown(body, { fileURL: pathToFileURL(filePath) }) })
        }
        logger.info(`Loaded ${documents.length} collocated documents`)
      }
      await sync()
      watcher?.on("change", async (path) => { if (watched.has(path)) await sync() })
      watcher?.on("unlink", async (path) => { if (watched.has(path)) await sync() })
      watcher?.on("add", async (path) => {
        if (path.startsWith(root) && path.endsWith("README.md") && !path.includes("node_modules")) await sync()
      })
    },
  }
}
