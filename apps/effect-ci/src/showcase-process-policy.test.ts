import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";

test("owned showcase execution drops capabilities before entering the project shell", async () => {
  const require = createRequire(import.meta.url);
  const plugin = realpathSync(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
  const bundle = await build({ stdin: { resolveDir: new URL(".", import.meta.url).pathname, loader: "ts", contents: `
    import {WorkspaceContainer} from './monorepo-container.ts';
    import {showcaseReadyCommand} from './showcase-process-policy.ts';
    export default{async fetch(request){const image=await request.text(),commands=[],stored=new Map();
      const host=Object.create(WorkspaceContainer.prototype);
      Object.defineProperties(host,{ctx:{value:{storage:{get:async k=>stored.get(k),put:async(k,v)=>stored.set(k,v)},container:{running:false,images:{showcase:'fixture',ci:'fixture'},start(){this.running=true},exec:async command=>{
        commands.push(command);return{output:async()=>({exitCode:0,stdout:new Uint8Array(),stderr:new Uint8Array()})};
      }}}},env:{value:{}},queue:{value:Promise.resolve(),writable:true}});
      await host.execute('node project.mjs','/workspace/repository/examples/demo','test',undefined,[],undefined,{image,loginShell:false,readyCommand:showcaseReadyCommand});
      return Response.json(commands);
    }};
  ` }, bundle: true, write: false, format: "esm", target: "esnext", conditions: ["workerd", "import"], external: ["cloudflare:*", "node:*"] });
  const runtime = new Miniflare({ workers: [{ config: { name: "showcase-process-policy", compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: bundle.outputFiles[0].text } } },
  } }] });
  try {
    for (const image of ["showcase", "ci"]) {
      const response = await runtime.dispatchFetch("https://fixture.invalid", { method: "POST", body: image });
      assert.equal(response.status, 200);
      const commands = await response.json() as string[][];
      assert.equal(commands.length, 2, "readiness must precede the project process");
      for (const [index, command] of ["/usr/local/bin/node /opt/effect-ci-showcase/verify-process.cjs", "node project.mjs"].entries()) {
        const shell = ["/bin/sh", "-c", command];
        assert.deepEqual(commands[index], image === "showcase" ? ["/usr/bin/setpriv", "--reuid=1000", "--regid=1000", "--clear-groups",
          "--inh-caps=-all", "--ambient-caps=-all", "--bounding-set=-all", "--no-new-privs", "--", ...shell] : shell);
      }
    }
  } finally { await runtime.dispose(); }
});
