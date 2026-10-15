import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const plugin = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
const { build } = require(require.resolve("esbuild", { paths: [plugin] }));

test("actual workerd note reader supports fetch and refuses redirects without following", async () => {
  const revision = "a".repeat(40),
    commit = "b".repeat(40),
    tree = "c".repeat(40);
  const text = "unsigned runtime reader fixture, not reuse authority";
  const blob = createHash("sha1").update(`blob ${text.length}\0${text}`).digest("hex");
  const replies = [
    { ref: "refs/notes/effect-ci-hosted-checks-v1", object: { type: "commit", sha: commit } },
    { sha: commit, tree: { sha: tree } },
    {
      sha: tree,
      truncated: false,
      tree: [{ path: revision, type: "blob", mode: "100644", sha: blob }],
    },
    { sha: blob, encoding: "base64", size: text.length, content: btoa(text) },
  ];
  const output = await build({
    stdin: {
      resolveDir: new URL(".", import.meta.url).pathname,
      loader: "ts",
      contents: `
      import {readGitHubCheckNote} from "../../../packages/cloudflare/src/check-note.ts";
      export default {async fetch(request){
        const redirect=new URL(request.url).searchParams.has('redirect');
        const note=await readGitHubCheckNote({repository:'owner/fixture',request:(url,init)=>fetch(url,{...init,headers:{...init.headers,'x-fixture-redirect':String(redirect)}})},'${revision}');
        return Response.json(note??null);
      }};
    `,
    },
    bundle: true,
    format: "esm",
    platform: "neutral",
    write: false,
    target: "esnext",
  });
  const runtime = new Miniflare({
    workers: [
      {
        config: {
          name: "note-reader",
          compatibilityDate: "2026-10-07",
          manifest: {
            mainModule: "index.js",
            modules: { "index.js": { type: "esm", contents: output.outputFiles[0].text } },
          },
          exports: {},
        },
        dev: { outboundService: { type: "worker", worker: "note-api-fixture" } },
      },
      {
        config: {
          name: "note-api-fixture",
          compatibilityDate: "2026-10-07",
          manifest: {
            mainModule: "index.js",
            modules: {
              "index.js": {
                type: "esm",
                contents: `
      const replies=${JSON.stringify(replies)};
      export default {fetch(request){
        if(new URL(request.url).hostname!=='api.github.com')throw Error('Redirect followed to another origin');
        if(request.headers.get('x-fixture-redirect')==='true')return new Response(null,{status:302,headers:{location:'https://must-not-follow.invalid/'}});
        const path=new URL(request.url).pathname;
        const index=path.includes('/ref/')?0:path.includes('/commits/')?1:path.includes('/trees/')?2:3;
        return Response.json(replies[index]);
      }};
    `,
              },
            },
          },
          exports: {},
        },
      },
    ],
  });
  try {
    const note = await (await runtime.dispatchFetch("https://reader.invalid/")).json();
    assert.deepEqual(note, { notesCommit: commit, blobSha: blob, text });
    assert.equal(
      await (await runtime.dispatchFetch("https://reader.invalid/?redirect")).json(),
      null,
    );
  } finally {
    await runtime.dispose();
  }
});
