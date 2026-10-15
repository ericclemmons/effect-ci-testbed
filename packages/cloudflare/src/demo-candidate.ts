import {
  demoAssetNames,
  demoSite,
  demoSiteOrigin,
  demoSiteUrl,
  siteRevision,
  assetHash,
  type DemoSite,
} from "./demo-site.ts";
export const demoCandidatePolicy = "owned-vite-release-pointer-v1";
export interface DemoCandidateReceipt {
  revision: string;
  digest: string;
  moduleDigest: string;
  policy: typeof demoCandidatePolicy;
  version: string;
  script: "effect-ci-hmd-demo";
}

/** A release pointer to the exact immutable build, not a second build or arbitrary Worker source. */
export async function readPublishedDemo(
  revision: string,
  digest: string,
  transport: typeof fetch = fetch,
): Promise<DemoSite> {
  siteRevision(revision);
  if (!/^[a-f0-9]{64}$/.test(digest)) throw Error("Invalid asset identity");
  const assets: Record<string, string> = {};
  for (const name of demoAssetNames) {
    const response = await transport(`${demoSiteOrigin}/r/${revision}/${digest}/${name}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
    if (
      response.status !== 200 ||
      response.headers.get("x-site-revision") !== revision ||
      response.headers.get("x-site-digest") !== digest
    ) {
      await response.body?.cancel();
      throw Error("Published build identity mismatch");
    }
    const reader = response.body?.getReader();
    if (!reader) throw Error("Missing asset body");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 256 * 1024) throw Error("Asset limit exceeded");
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    assets[name] = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }
  const site = await demoSite(revision, assets);
  if (site.digest !== digest) throw Error("Published build bytes mismatch");
  return site;
}

export async function demoCandidateModule(
  site: DemoSite,
): Promise<{ module: string; moduleDigest: string }> {
  const checked = await demoSite(site.revision, site.assets);
  if (checked.digest !== site.digest) throw Error("Candidate assets mismatch");
  // No project JavaScript is evaluated in this credential-free routing Worker.
  // The browser receives the unchanged build from its independent immutable origin,
  // avoiding mixed-version HTML/JS requests during a percentage rollout.
  const identity = {
    revision: checked.revision,
    digest: checked.digest,
    url: demoSiteUrl(checked),
    files: checked.files,
  };
  const module = `const build=${JSON.stringify(identity)};
export default {fetch(request,env){
 const headers={'cache-control':'no-store','x-build-revision':build.revision,'x-build-digest':build.digest};
 if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed',{status:405,headers});
 if(!/^[a-f0-9-]{36}$/.test(env.WORKER_METADATA?.id??'')||env.FAILURE_RATE!=='0')return new Response('Invalid release configuration',{status:503,headers});
 headers['x-worker-version']=env.WORKER_METADATA.id;
 const path=new URL(request.url).pathname;
 if(path==='/health'){
  console.log(JSON.stringify({hmd:{versionId:env.WORKER_METADATA.id,invocation:'fetch',outcome:'ok'},build:{revision:build.revision,digest:build.digest}}));
  return request.method==='HEAD'?new Response(null,{headers}):Response.json({version:env.WORKER_METADATA.id,healthy:true,revision:build.revision,digest:build.digest},{headers});
 }
 if(path==='/'){headers.location=build.url;return new Response(null,{status:302,headers});}
 return new Response('Not found',{status:404,headers});
}};`;
  return { module, moduleDigest: await assetHash(module) };
}
