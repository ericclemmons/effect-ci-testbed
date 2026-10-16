import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { projectPolicy, runProjectChecks } from "@effect-ci-testbed/cloudflare-dynamic-worker/project";
import { fixedMode } from "./mode.ts";

/** Owned fixed hostile fixtures, never arbitrary operator modules or capabilities. */
export class ProjectBoundaryWorkflow extends WorkflowEntrypoint<{ LOADER: WorkerLoader }, unknown> {
  async run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) {
    try { fixedMode(event.payload, "verify-boundaries"); } catch { throw new NonRetryableError("Exact owned boundary mode required"); }
    const invoke = (source: string, body: string, twice = false) => runProjectChecks(this.env.LOADER, {
      mainModule: "index.js", modules: { "index.js": source }, checks: [{ name: "boundary", path: "/", status: 200, body },
        ...(twice ? [{ name: "fresh globals", path: "/", status: 200, body }] : [])] });
    const results: Record<string, unknown> = {};
    const policy = { retries: { limit: 0, delay: "1 second" }, timeout: "10 seconds" } as const;
    for (const [name, source, body, twice] of [
      ["network", `import {connect} from 'cloudflare:sockets';export default {async fetch(){let https=false,tcp=false;try{await fetch('https://example.com')}catch{https=true}try{const s=connect('example.com:443');await s.opened}catch{tcp=true}return new Response(JSON.stringify({https,tcp}));}};`, '{"https":true,"tcp":true}', false],
      ["bindings", `export default {fetch(req,env){return new Response(JSON.stringify(Object.keys(env)))}};`, "[]", false],
      ["fresh-globals", `let n=0;export default {fetch(){return new Response(String(++n))}};`, "1", true],
    ] as const) results[name] = await step.do(`boundary:${name}`, policy, () => invoke(source, body, twice));
    results["host-filesystem"] = await step.do("boundary:host-filesystem", policy, () => invoke(
      `import fs from 'node:fs';export default {fetch(){try{fs.readFileSync('/proc/self/environ');return new Response('escaped')}catch{return new Response('blocked')}}};`, "blocked"));
    for (const [name, source] of [
      ["mismatch", `export default {fetch(){return new Response('wrong')}};`],
      ["oversized", `export default {fetch(){return new Response('x'.repeat(4097))}};`],
      ["cpu", `export default {fetch(req){if(new URL(req.url).pathname==='/preflight')return new Response('ready');while(true){}}};`],
    ] as const) results[name] = await step.do(`boundary:${name}`, policy, async () => {
      if (name === "cpu") await runProjectChecks(this.env.LOADER, { mainModule: "index.js", modules: { "index.js": source },
        checks: [{ name: "loop preflight", path: "/preflight", status: 200, body: "ready" }] });
      const started = Date.now(); let rejected = false;
      try { await invoke(source, "ok"); } catch { rejected = true; }
      const elapsedMs = Date.now() - started;
      if (!rejected || (name === "cpu" && elapsedMs >= projectPolicy.timeoutMs - 1000)) throw new NonRetryableError("Prompt boundary rejection not established");
      return { rejected, elapsedMs, policyCpuMs: projectPolicy.cpuMs, containers: 0,
        ...(name === "cpu" ? { modulePreflightPassed: true } : {}) };
    });
    return { results, containers: 0 };
  }
}
