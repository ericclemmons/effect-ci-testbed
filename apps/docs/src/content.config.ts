import { defineCollection } from "astro:content"
import { docsSchema } from "@astrojs/starlight/schema"
import { readmes } from "./readme-loader.ts"

export const collections = {
  docs: defineCollection({ loader: readmes(), schema: docsSchema() }),
}
