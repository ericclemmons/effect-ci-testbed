import { resolve } from "node:path"
import { copyFile, mkdir } from "node:fs/promises"
import {
  cleanBuildOutputDir,
  getWorkerBundleDir,
  readBuildOutput,
  writeAssets,
  writeRootConfig,
  writeWorkerConfig,
} from "@cloudflare/build-output-utils"
import config from "../cloudflare.config.ts"

// Keep the static site and its small readiness API in the same deployment.
const root = resolve(import.meta.dirname, "..")
await cleanBuildOutputDir(root)
await writeRootConfig(root, undefined, { isPreview: false, mode: undefined })
await mkdir(getWorkerBundleDir(root), { recursive: true })
await copyFile(resolve(root, "src/worker.mjs"), resolve(getWorkerBundleDir(root), "worker.mjs"))
await writeWorkerConfig({ root, config: config.worker, manifest: {
  type: "complete", mainModule: "worker.mjs", modules: { "worker.mjs": { type: "esm" } },
} })
await writeAssets({ root, sourceDirectory: resolve(root, "dist") })
await readBuildOutput(root)
