import { NonRetryableError } from "cloudflare:workflows"
import { WorkflowEntrypoint, type WorkflowStep } from "cloudflare:workers"
import { projectPolicy, runProjectChecks } from "@effect-ci-testbed/cloudflare-dynamic-worker/project"

/** Fixed administrative probes, not arbitrary operator code or additional child capabilities. */
export class DynamicProjectBoundaryWorkflow extends WorkflowEntrypoint<{ LOADER: WorkerLoader }> {
  override async run(_event: unknown, step: WorkflowStep) {
    const invoke = (source: string, body: string, twice = false) => runProjectChecks(this.env.LOADER, {
      mainModule: "index.js", modules: { "index.js": source },
      checks: [{ name: "boundary", path: "/", status: 200, body }, ...(twice ? [
        { name: "fresh globals", path: "/", status: 200, body },
      ] : [])],
    })
    const results: Record<string, unknown> = {}
    for (const [name, source, body, twice] of [
      ["network", `import {connect} from 'cloudflare:sockets'; export default {async fetch(){
        let https=false,tcp=false;
        try{await fetch('https://example.com')}catch{https=true}
        try{const socket=connect('example.com:443');await socket.opened}catch{tcp=true}
        return new Response(JSON.stringify({https,tcp}));}};`, '{"https":true,"tcp":true}', false],
      ["bindings", `export default {fetch(req,env){return new Response(JSON.stringify(Object.keys(env)))}};`, "[]", false],
      ["fresh-globals", `let counter=0;export default {fetch(){return new Response(String(++counter))}};`, "1", true],
    ] as const) {
      results[name] = await step.do(`boundary:${name}`, { retries: { limit: 0, delay: "1 second" } }, () => invoke(source, body, twice))
    }
    results["host-filesystem"] = await step.do("boundary:host-filesystem", { retries: { limit: 0, delay: "1 second" } }, async () => {
      // Some hosted runtimes resolve Node built-ins even without Node compatibility flags.
      // Import rejection is not the contract: native host files must never be readable.
      try {
        return await invoke(`import fs from 'node:fs';export default {fetch(){
          try{fs.readFileSync('/proc/self/environ');return new Response('escaped')}
          catch{return new Response('blocked')}}};`, "blocked")
      } catch {
        // A compile-time unavailable import also withholds this capability. Separately test
        // unexpected assertion results below: an escaped response must not be accepted here.
        throw new NonRetryableError("Host-filesystem probe requires explicit denied response on this hosted runtime")
      }
    })
    for (const [name, source] of [
      ["mismatch", `export default {fetch(){return new Response('wrong')}};`],
      ["oversized", `export default {fetch(){return new Response('x'.repeat(4097))}};`],
      ["cpu", `export default {fetch(){while(true){} }};`],
    ] as const) {
      results[name] = await step.do(`boundary:${name}`, { retries: { limit: 0, delay: "1 second" }, timeout: "10 seconds" }, async () => {
        const started = Date.now()
        let rejected = false
        try { await invoke(source, "ok") } catch { rejected = true }
        const elapsedMs = Date.now() - started
        if (!rejected || (name === "cpu" && elapsedMs >= projectPolicy.timeoutMs - 1000)) {
          throw new NonRetryableError("Boundary probe did not establish prompt execution rejection")
        }
        return { rejected, elapsedMs, policyCpuMs: projectPolicy.cpuMs, containers: 0 }
      })
    }
    return results
  }
}
