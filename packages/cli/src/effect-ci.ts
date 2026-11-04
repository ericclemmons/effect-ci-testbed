#!/usr/bin/env node

import "./sdk-loader.ts"

const { runCli } = await import("./index.ts")

await runCli()
