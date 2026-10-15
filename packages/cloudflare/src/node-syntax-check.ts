import { hostedCheckBytes, type HostedCheckIdentity } from "./check-evidence.ts";

export const syntaxRepository = "https://github.com/ericclemmons/effect-ci-testbed";
export const syntaxWorkflow = "cf-ci-demo";
export const syntaxKeyId = "demo-node-syntax-v1";
export const syntaxImage =
  "sha256:7b2ede4459d6738f1465db630f3fe3794fd9c9ba28f8b5a9dffc3900b8df9924";
export const syntaxDockerImage = syntaxImage;
export const syntaxPublicKey = {
  kty: "OKP",
  crv: "Ed25519",
  x: "SATmbVsBJhPJ-ahWATsqlbjr24qYPxaX-DUAu7MJAjU",
};
export const syntaxRoot = "examples/demo";
export const syntaxPaths = ["package.json", "package-lock.json", "src/message.ts"] as const;
const parseOnly = `const fs=require('node:fs');const text=new TextDecoder('utf-8',{fatal:true}).decode(fs.readFileSync('src/message.ts'));const js=require('node:module').stripTypeScriptTypes(text,{mode:'strip'});new(require('node:vm').SourceTextModule)(js);`;
const shellQuote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
export const syntaxCommand = `env -i PATH=/usr/local/bin:/usr/bin:/bin /usr/local/bin/node --no-warnings --experimental-vm-modules --input-type=commonjs -e ${shellQuote(parseOnly)}`;
/** Local feedback only: resolve installed Node without claiming the enrolled Linux toolchain. */
export const syntaxLocalCommand = `env -i PATH="$PATH" node --no-warnings --experimental-vm-modules --input-type=commonjs -e ${shellQuote(parseOnly)}`;

// Trusted runner code, not a project command. No source imports or execution.
const inspector = `const fs=require('node:fs'),p=require('node:path'),c=require('node:crypto');
const sha=b=>c.createHash('sha256').update(b).digest('hex');
const files=${JSON.stringify(syntaxPaths)}.map(path=>{const f=p.resolve(path),s=fs.lstatSync(f);if(!s.isFile()||s.isSymbolicLink()||fs.realpathSync(f)!==f||s.size>4194304)throw Error('Ineligible syntax input');const b=fs.readFileSync(f);return {path,size:b.length,sha256:sha(b)}});
console.log(JSON.stringify({version:1,files,node:sha(fs.readFileSync(process.execPath)),runtime:process.version,platform:process.platform,arch:process.arch,versions:process.versions}));`;
const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
export const syntaxInspectCommand = `env -i PATH=/usr/local/bin:/usr/bin:/bin /usr/local/bin/node --input-type=commonjs -e ${quote(inspector)}`;

const digest = async (value: unknown) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");

export const syntaxPolicyDigest = () =>
  digest([
    "demo-node-syntax-only-v1",
    syntaxRepository,
    syntaxWorkflow,
    "syntax",
    syntaxCommand,
    syntaxPaths,
    syntaxInspectCommand,
    "parse-only/no-imports/no-install/no-project-execution",
    syntaxImage,
  ]);

/** Only a host-produced descriptor of actual prepared files/runtime is eligible.
 * The fixed parser cannot link/evaluate source, run hooks, or read dependencies.
 */
export const syntaxIdentity = async (
  revision: string,
  text: string,
): Promise<HostedCheckIdentity> => {
  if (text.length > 8192) throw new Error("Oversize syntax descriptor");
  const value = JSON.parse(text);
  if (
    value.version !== 1 ||
    !Array.isArray(value.files) ||
    value.files.length !== syntaxPaths.length ||
    !/^[0-9a-f]{64}$/.test(value.node) ||
    value.platform !== "linux" ||
    value.arch !== "x64" ||
    !/^v24\./.test(value.runtime) ||
    typeof value.versions !== "object" ||
    !value.versions
  ) {
    throw new Error("Ineligible syntax toolchain");
  }
  const files = value.files.map((file: any, index: number) => {
    if (
      file.path !== syntaxPaths[index] ||
      !Number.isInteger(file.size) ||
      file.size < 1 ||
      file.size > 4194304 ||
      !/^[0-9a-f]{64}$/.test(file.sha256)
    )
      throw new Error("Ineligible syntax files");
    return [file.path, file.size, file.sha256];
  });
  const identity: HostedCheckIdentity = {
    kind: "check",
    repository: syntaxRepository,
    revision,
    workflowId: syntaxWorkflow,
    stepId: "syntax",
    command: syntaxCommand,
    policyDigest: await syntaxPolicyDigest(),
    sourceDigest: await digest(files),
    toolchainDigest: await digest([
      value.node,
      value.runtime,
      value.platform,
      value.arch,
      Object.entries(value.versions).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ]),
  };
  hostedCheckBytes(identity);
  return identity;
};
