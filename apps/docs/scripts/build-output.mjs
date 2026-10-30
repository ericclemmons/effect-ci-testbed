import { resolve } from "node:path"
import { copyFile } from "node:fs/promises"
import { snapshotPath } from "../src/readiness.mjs"
import {
  cleanBuildOutputDir,
  readBuildOutput,
  writeAssets,
  writeRootConfig,
  writeWorkerConfig,
} from "@cloudflare/build-output-utils"
import config from "../cloudflare.config.ts"

const root = resolve(import.meta.dirname, "..")
await copyFile(snapshotPath, resolve(root, "dist/readiness.json"))
await cleanBuildOutputDir(root)
await writeRootConfig(root, undefined, { isPreview: false, mode: undefined })
await writeWorkerConfig({ root, config: config.worker })
await writeAssets({ root, sourceDirectory: resolve(root, "dist") })
await readBuildOutput(root)
