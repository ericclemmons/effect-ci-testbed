import { resolve } from "node:path"
import {
  cleanBuildOutputDir,
  writeAssets,
  writeRootConfig,
  writeWorkerConfig,
} from "@cloudflare/build-output-utils"
import config from "../cloudflare.config.ts"

// Give cf the verified static output directly; no SSR adapter or app runtime.
const root = resolve(import.meta.dirname, "..")
await cleanBuildOutputDir(root)
await writeRootConfig(root, undefined, { isPreview: false, mode: undefined })
await writeWorkerConfig({ root, config: config.worker })
await writeAssets({ root, sourceDirectory: resolve(root, "dist") })
