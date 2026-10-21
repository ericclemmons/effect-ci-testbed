import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";

test("the actual showcase API composes with verified Access without granting release authority", async () => {
  const require = createRequire(import.meta.url);
  const plugin = realpathSync(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
  const output = await build({ stdin: { resolveDir: new URL(".", import.meta.url).pathname, loader: "ts", contents: `
    import {Buffer} from 'node:buffer';
    import {showcaseApi} from './showcase-api.ts';
    import {demoAccessRequest,demoRemoteAccessRoute} from './demo-access.ts';
    import {demoAccessOrigin} from './demo-access-policy.ts';
    import {accessIdentityVerifier} from '@effect-ci-testbed/github-cloudflare/access-identity';
    export default{async fetch(){
      const issuer='https://fixture.cloudflareaccess.com',audience='a'.repeat(64),subject='fixture-owner';
      const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
      const key={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'fixture',alg:'RS256',use:'sig'};
      const subjectSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(subject))),b=>b.toString(16).padStart(2,'0')).join('');
      const verify=accessIdentityVerifier({issuer,audience,subjectSha256},{fetch:async()=>Response.json({keys:[key]})});
      const now=Math.floor(Date.now()/1000),encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
      const input=encode({alg:'RS256',kid:'fixture'})+'.'+encode({iss:issuer,aud:[audience],sub:subject,iat:now-1,exp:now+300,type:'app'});
      const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(input));
      const token=input+'.'+Buffer.from(signature).toString('base64url'),created=[],id='22222222-2222-4222-8222-222222222222';
      const environment={EFFECT_CI_API_TOKEN:'private-host-key'};
      const context={exports:{ShowcaseCIWorkflow:{create:async p=>{created.push(p);return{id}}},TrustedDemoChecks:{getByName:()=>({executionHistory:async()=>({executions:[]})})}}};
      const body={repository:'https://github.com/ericclemmons/effect-ci-testbed.git',revision:'a'.repeat(40),targets:['test','build']};
      const call=async(path,method='GET',payload,headers={})=>{
        const request=new Request(demoAccessOrigin+path,{method,headers:{'cf-access-jwt-assertion':token,'content-type':'application/json',...headers},...(payload?{body:JSON.stringify(payload)}:{})});
        return showcaseApi.fetch(await demoAccessRequest(request,environment.EFFECT_CI_API_TOKEN,verify),environment,context);
      };
      const statuses=[];
      statuses.push((await call('/showcase/capabilities')).status);
      statuses.push((await call('/showcase/runs','POST',body)).status);
      statuses.push((await call('/showcase/executions?revision='+body.revision)).status);
      statuses.push((await call('/showcase/runs','POST',{...body,targets:['deploy']})).status);
      statuses.push((await call('/showcase/runs','POST',{...body,repository:'https://github.com/foreign/repo.git'})).status);
      statuses.push((await call('/showcase/runs','POST',body,{origin:'https://foreign.invalid'})).status);
      statuses.push((await call('/showcase/capabilities','GET',undefined,{'cf-access-jwt-assertion':'invalid'})).status);
      statuses.push((await call('/showcase/capabilities','GET',undefined,{authorization:'Bearer wrong'})).status);
      const routes=['/showcase/runs/'+id,'/showcase/runs/'+id+'/events','/showcase/runs/'+id+'/approvals/review','/showcase/runs/foreign%2Fid/events'];
      return Response.json({statuses,created,identityLeaked:JSON.stringify(created).includes(token),
        routes:routes.map(path=>demoRemoteAccessRoute(new Request(demoAccessOrigin+path)))});
    }};
  ` }, bundle: true, write: false, format: "esm", target: "esnext", conditions: ["workerd", "import"], external: ["cloudflare:*", "node:*"] });
  const runtime = new Miniflare({ workers: [{ config: { name: "showcase-access-composition", compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: output.outputFiles[0].text } } },
  } }] });
  try {
    const response = await runtime.dispatchFetch("https://fixture.invalid");
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.ok(!text.includes("private-host-key"));
    const result = JSON.parse(text);
    assert.deepEqual(result.statuses, [200, 202, 200, 403, 403, 401, 401, 401]);
    assert.equal(result.created.length, 1, "only the enrolled authenticated compute request dispatches");
    assert.equal(result.identityLeaked, false, "the signed Access identity stays outside workflow inputs");
    assert.deepEqual(result.routes, [true, true, false, false]);
    assert.ok(!JSON.stringify(result.created).includes("cf-access"));
  } finally { await runtime.dispose(); }
});
