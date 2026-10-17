import { hostedCheckBytes, type HostedCheckIdentity } from "./check-evidence.ts";
import {
  syntaxImage,
  syntaxKeyId,
  syntaxPublicKey,
  syntaxRepository,
  syntaxRoot,
  syntaxWorkflow,
} from "./node-syntax-check.ts";

export {
  syntaxImage as testImage,
  syntaxKeyId as testKeyId,
  syntaxPublicKey as testPublicKey,
  syntaxRepository as testRepository,
  syntaxRoot as testRoot,
  syntaxWorkflow as testWorkflow,
};
export const testNotesRef = "refs/notes/effect-ci-demo-tests-v1";
// This policy authorizes the actual Vitest suite, NOT npm's pretest hook.
// Typecheck remains an independently executed prerequisite in the host graph.
export const testCommand =
  "env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp CI=true ./node_modules/.bin/vp test --run";
export const testFixedInputs: Record<string, string> = {
  "package.json": "0319593ce79a34fc4bf4124105336c10267f62a89f63aee0a2f54a4735092367",
  "package-lock.json": "ae17858846c5eca307acc3dd3964b4c9e36afe610429771a202b7e5481b51b31",
  "vite.config.ts": "7bc09977035bc1a7542df0053a8ecaf6e61b111c443b302518210cd7754bf14e",
  "tsconfig.json": "0b416efba95d4742f4bfbcae9af3d25342caa622f4401e711d2d0fe62eb1864e",
  "src/app.ts": "04b8af3ea0986e7719a2155bd6c4fd5f909a9fc8a87e6cb5cd9875c1b497c0d4",
  "src/message.test.ts": "8e7ba13fa8cec1fb1121a19d28579a8dcbb5b314fda617f2f85e3ef580d087ef",
  "index.html": "e7554d5c3c632c2bcba87292bd523f25cdb67915b6001b6c63f78e242fb82c31",
};
export const testPaths = [...Object.keys(testFixedInputs), "src/message.ts"].sort();
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
// Trusted inspector: reads bytes, never imports project modules. Real dependency
// files and internal symlinks are hashed, not just a claimed lockfile digest.
const inspector = `const fs=require('node:fs'),p=require('node:path'),c=require('node:crypto');
const sha=b=>c.createHash('sha256').update(b).digest('hex');
const root=fs.realpathSync('.'),fixed=${JSON.stringify(testFixedInputs)},paths=${JSON.stringify(testPaths)};
const file=path=>{const f=p.resolve(path),s=fs.lstatSync(f);if(!s.isFile()||s.isSymbolicLink()||fs.realpathSync(f)!==f||s.size>4194304)throw Error('Ineligible input');const b=fs.readFileSync(f);return {path,size:b.length,sha256:sha(b)}};
if(JSON.stringify(fs.readdirSync('src').sort())!==JSON.stringify(['app.ts','message.test.ts','message.ts']))throw Error('Changed suite');
const files=paths.map(file);for(const f of files)if(fixed[f.path]&&fixed[f.path]!==f.sha256)throw Error('Changed suite policy');
const message=fs.readFileSync('src/message.ts','utf8').trim(),prefix='export const message = ';if(message.length>8192||!message.startsWith(prefix)||!message.endsWith(';'))throw Error('Nonliteral demo message');const literal=JSON.parse(message.slice(prefix.length,-1));if(typeof literal!=='string'||message!==prefix+JSON.stringify(literal)+';')throw Error('Nonliteral demo message');
const deps=p.join(root,'node_modules');if(fs.realpathSync(deps)!==deps)throw Error('External dependencies');const entries=[];let bytes=0;
const walk=dir=>{for(const name of fs.readdirSync(p.join(deps,dir)).sort()){const rel=p.posix.join(dir,name);if(rel==='.vite'||rel==='.cache')continue;const f=p.join(deps,rel),s=fs.lstatSync(f);if(s.isSymbolicLink()){const target=fs.realpathSync(f);if(!target.startsWith(deps+'/'))throw Error('External dependency link');entries.push([rel,'link',fs.readlinkSync(f)]);}else if(s.isDirectory())walk(rel);else if(s.isFile()){bytes+=s.size;if(bytes>1073741824||entries.length>100000)throw Error('Dependency bound');entries.push([rel,s.size,sha(fs.readFileSync(f))]);}else throw Error('Special dependency file');}};walk('');
console.log(JSON.stringify({version:1,files,dependencies:sha(JSON.stringify(entries)),dependencyFiles:entries.length,node:sha(fs.readFileSync(process.execPath)),runtime:process.version,platform:process.platform,arch:process.arch,versions:process.versions}));`;
export const testInspectCommand = `env -i PATH=/usr/local/bin:/usr/bin:/bin /usr/local/bin/node --input-type=commonjs -e ${quote(inspector)}`;
const digest = async (v: unknown) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(v))),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
export const testPolicyDigest = () =>
  digest([
    "demo-vitest-suite-v1",
    syntaxRepository,
    syntaxWorkflow,
    "test",
    testCommand,
    testFixedInputs,
    testInspectCommand,
    syntaxImage,
    "local-networkless-execution/key-outside-container/typecheck-not-attested",
  ]);
export async function testIdentity(revision: string, text: string): Promise<HostedCheckIdentity> {
  if (text.length > 16384) throw Error("Oversize test descriptor");
  const v = JSON.parse(text),
    hex = /^[a-f0-9]{64}$/;
  if (
    v.version !== 1 ||
    v.platform !== "linux" ||
    v.arch !== "x64" ||
    !/^v24\./.test(v.runtime) ||
    !hex.test(v.node) ||
    !hex.test(v.dependencies) ||
    !Number.isInteger(v.dependencyFiles) ||
    v.dependencyFiles < 1 ||
    v.dependencyFiles > 100000 ||
    !v.versions ||
    typeof v.versions !== "object" ||
    !Array.isArray(v.files) ||
    v.files.length !== testPaths.length
  )
    throw Error("Ineligible test descriptor");
  const files = v.files.map((f: any, i: number) => {
    if (
      f.path !== testPaths[i] ||
      !Number.isInteger(f.size) ||
      f.size < 1 ||
      f.size > 4194304 ||
      !hex.test(f.sha256) ||
      (testFixedInputs[f.path] && testFixedInputs[f.path] !== f.sha256)
    )
      throw Error("Ineligible test inputs");
    return [f.path, f.size, f.sha256];
  });
  const identity: HostedCheckIdentity = {
    kind: "check",
    repository: syntaxRepository,
    revision,
    workflowId: syntaxWorkflow,
    stepId: "test",
    command: testCommand,
    policyDigest: await testPolicyDigest(),
    sourceDigest: await digest([files, v.dependencies, v.dependencyFiles]),
    toolchainDigest: await digest([
      syntaxImage,
      v.node,
      v.runtime,
      v.platform,
      v.arch,
      Object.entries(v.versions).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ]),
  };
  hostedCheckBytes(identity);
  return identity;
}
