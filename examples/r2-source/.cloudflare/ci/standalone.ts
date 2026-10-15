import * as CI from "@effect-ci-testbed/ci";
import * as Effect from "effect/Effect";

const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source;
  return () => source.checkout();
});
// Returning the workspace automatically commits and releases this consumer's
// container too; no manual artifact publication or always-running verifier VM.
const verify = CI.action("verify restored R2 bytes", () => function* () {
  const workspace = yield* checkout();
  if ((yield* workspace.readFile("source.txt")) !== "source from r2\n")
    return yield* Effect.fail(new Error("Restored R2 bytes mismatch"));
  // This fixed Node verifier runs in the downstream restored container. No
  // binding, key, account token or source-selection payload is given to it.
  const script = `const fs=require('node:fs'),crypto=require('node:crypto');const b=fs.readFileSync('source.txt');if(b.toString('utf8')!=='source from r2\\n')throw Error('Restored bytes mismatch');const keys=['SOURCE_BUCKET','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','CLOUDFLARE_API_TOKEN'];if(keys.some(k=>process.env[k]))throw Error('Storage capability reached container environment');console.log(JSON.stringify({verified:true,bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex'),storageCredentialsPresent:false}));`;
  return yield* workspace.exec(`node -e ${JSON.stringify(script)}`);
});
export default CI.workflow("r2-source-standalone", () => verify());
