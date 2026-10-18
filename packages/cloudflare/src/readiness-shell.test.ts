import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import test from "node:test";

test(
  "the real readiness method honors non-login policy before invoking project-modifiable startup files",
  { timeout: 30_000 },
  async () => {
    const require = createRequire(import.meta.url);
    const plugin = realpathSync(
      new URL("../../../apps/effect-ci/node_modules/@cloudflare/vite-plugin", import.meta.url),
    );
    const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
    const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
    const bundle = await build({
      stdin: {
        resolveDir: new URL(".", import.meta.url).pathname,
        loader: "ts",
        contents: `
    import{WorkspaceContainer}from'./index.ts';
    export default{async fetch(request){const commands=[],input=await request.json();
      const receiver={ensureRunning:async()=>{},markMutation:async()=>{},run:async(argv)=>{
        commands.push([...argv]);return{exitCode:input.missingGit&&argv.at(-1)==='command -v git'?1:0,stdout:'',stderr:''};}};
      if(input.checkout)await WorkspaceContainer.prototype.checkout.call(receiver,'https://github.com/acme/private.git','a'.repeat(40),'/workspace/repository',input);
      else await WorkspaceContainer.prototype.waitUntilReady.call(receiver,input);
      return Response.json(commands);
    }};
  `,
      },
      bundle: true,
      write: false,
      format: "esm",
      target: "esnext",
      conditions: ["workerd", "import"],
      external: ["cloudflare:*", "node:*"],
    });
    const runtime = new Miniflare({
      workers: [
        {
          config: {
            name: "readiness-shell-test",
            compatibilityDate: "2026-10-07",
            compatibilityFlags: ["nodejs_compat"],
            manifest: {
              mainModule: "index.js",
              modules: { "index.js": { type: "esm", contents: bundle.outputFiles[0].text } },
            },
          },
        },
      ],
    });
    const call = async (options: unknown) => {
      const response = await runtime.dispatchFetch("https://fixture.invalid", {
        method: "POST",
        body: JSON.stringify(options),
      });
      const text = await response.text();
      assert.equal(response.status, 200, text);
      return JSON.parse(text);
    };
    try {
      assert.deepEqual(await call({ readyCommand: "fixed-ready", loginShell: false }), [
        ["/bin/sh", "-c", "fixed-ready"],
      ]);
      assert.deepEqual(await call({ readyCommand: "fixed-ready" }), [["sh", "-lc", "fixed-ready"]]);
      assert.deepEqual(await call({ loginShell: false }), []);
      for (const missingGit of [false, true]) {
        const commands = await call({ checkout: true, missingGit, loginShell: false });
        assert.deepEqual(commands[0], ["/bin/sh", "-c", "command -v git"]);
        assert.ok(commands.every((argv: string[]) => !argv.includes("-lc")));
        if (missingGit) assert.match(commands[1][2], /^apt-get update/);
      }
    } finally {
      await runtime.dispose();
    }
  },
);
