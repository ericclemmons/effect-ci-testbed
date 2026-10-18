import { mkdirSync, writeFileSync } from "node:fs"
import { html } from "./app.mjs"

mkdirSync("dist", { recursive: true })
writeFileSync("dist/index.html", html)
