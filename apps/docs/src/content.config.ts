import { defineCollection } from "astro:content"
import { z } from "astro/zod"
import { defineDocSchema, withNimbusMarkdown } from "@cloudflare/nimbus-docs/content"
import { readmes } from "./readme-loader.ts"

export const collections = {
  docs: defineCollection({
    loader: withNimbusMarkdown(readmes()),
    schema: defineDocSchema({ fields: { sourceUrl: z.string().url() } }),
  }),
}
