import { mkdirSync, writeFileSync } from "node:fs"
import { html } from "./src/page.mjs"

mkdirSync("dist", { recursive: true })
writeFileSync("dist/index.html", html)
console.log("Built app/dist/index.html from the app and its shared dependency")
