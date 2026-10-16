import * as CI from "@effect-ci-testbed/ci";
import * as Effect from "effect/Effect";
const checkout = CI.action("checkout", function* () { const source = yield* CI.Source; return () => source.checkout(); });
const verify = CI.action("verify restored DO bytes", () => function* () {
  const workspace = yield* checkout();
  if ((yield* workspace.readFile("source.txt")) !== "source from durable object\n") return yield* Effect.fail(new Error("Restored bytes mismatch"));
  const script = `const fs=require('node:fs'),crypto=require('node:crypto');const b=fs.readFileSync('source.txt');if(b.toString('utf8')!=='source from durable object\\n')throw Error('Restored bytes mismatch');if(['SOURCE_REVISIONS','CLOUDFLARE_API_TOKEN'].some(k=>process.env[k]))throw Error('Storage capability in container');console.log(JSON.stringify({verified:true,bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex'),storageCredentialsPresent:false}));`;
  return yield* workspace.exec(`node -e ${JSON.stringify(script)}`);
});
export default CI.workflow("durable-source-standalone", () => verify());
