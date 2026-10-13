export const SOURCE_FILES = [
  "build.js",
  "escape.js",
  "content.json",
  "client.js",
  "style.css",
] as const;
export const LIMITS = {
  sourceBytes: 65_536,
  outputBytes: 131_072,
  files: 16,
  cpuMs: 250,
  timeoutMs: 5_000,
} as const;
export type Files = Record<string, string>;
export interface Site {
  revision: string;
  sourceDigest: string;
  assetDigest: string;
  assets: Files;
}
export function revisionFor(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value))
    throw new Error("Full immutable revision required");
  return value;
}
export function filesFor(value: unknown, limit: number = LIMITS.outputBytes): Files {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error("Invalid file manifest");
  const entries = Object.entries(value);
  if (!entries.length || entries.length > LIMITS.files) throw new Error("Invalid file manifest");
  let bytes = 0;
  // Only restricted filename keys enter this plain RPC-serializable record.
  const result: Files = {};
  for (const [path, content] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    if (!/^[a-z][a-z0-9-]*\.(html|css|js|json)$/.test(path) || typeof content !== "string")
      throw new Error("Invalid file manifest");
    bytes += new TextEncoder().encode(content).length;
    if (bytes > limit) throw new Error("File manifest exceeds limit");
    result[path] = content;
  }
  return result;
}
export async function digest(files: Files) {
  const bytes = new TextEncoder().encode(
    JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
  );
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
export async function readBounded(response: Response, limit: number) {
  if (!response.body) throw new Error("Missing response");
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("Response exceeds limit");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function checkoutSource(raw: string, fetcher: typeof fetch = fetch): Promise<Files> {
  const revision = revisionFor(raw);
  const files: Files = {};
  for (const name of SOURCE_FILES) {
    const response = await fetcher(
      `https://raw.githubusercontent.com/ericclemmons/effect-ci-testbed/${revision}/examples/containerless-site/site/${name}`,
      { redirect: "manual", signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) throw new Error("Pinned source fetch failed");
    files[name] = await readBounded(response, LIMITS.sourceBytes);
  }
  return filesFor(files, LIMITS.sourceBytes);
}
/** Project modules execute only in the child. No network or host bindings. */
export async function buildSite(loader: WorkerLoader, raw: Files): Promise<Files> {
  const files = filesFor(raw, LIMITS.sourceBytes);
  if (Object.keys(files).sort().join() !== [...SOURCE_FILES].sort().join())
    throw new Error("Required source missing");
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const child = loader
      .load({
        compatibilityDate: "2026-10-07",
        compatibilityFlags: [],
        mainModule: "build.js",
        modules: { "build.js": files["build.js"]!, "escape.js": files["escape.js"]! },
        env: {},
        globalOutbound: null,
        limits: { cpuMs: LIMITS.cpuMs, subRequests: 0 },
      })
      .getEntrypoint();
    return await Promise.race([
      (async () => {
        const response = await child.fetch(
          new Request("https://build.invalid/", {
            method: "POST",
            body: JSON.stringify(files),
            signal: abort.signal,
          }),
        );
        if (response.status !== 200) throw new Error("Build response rejected");
        const assets = filesFor(JSON.parse(await readBounded(response, LIMITS.outputBytes * 2)));
        if (Object.keys(assets).sort().join() !== "client.js,index.html,style.css")
          throw new Error("Unexpected build outputs");
        return assets;
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          abort.abort();
          reject(new Error("Build deadline"));
        }, LIMITS.timeoutMs);
      }),
    ]);
  } catch {
    throw new Error("Isolated site build failed");
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
}
/** Static output is served by a second, capability-limited Dynamic Worker. */
export async function serveSite(loader: WorkerLoader, site: Site, path: string): Promise<Response> {
  if (!Object.hasOwn(site.assets, path)) return new Response("Not found", { status: 404 });
  const modules = {
    "serve.js": `import assets from './assets.json'; export default {fetch(request){ const path = new URL(request.url).pathname.slice(1); if (!Object.hasOwn(assets,path)) return new Response('Not found',{status:404}); return new Response(assets[path]); }};`,
    "assets.json": { json: site.assets },
  };
  const child = loader
    .load({
      compatibilityDate: "2026-10-07",
      compatibilityFlags: [],
      mainModule: "serve.js",
      modules,
      env: {},
      globalOutbound: null,
      limits: { cpuMs: 50, subRequests: 0 },
    })
    .getEntrypoint();
  const response = await child.fetch(
    new Request(`https://site.invalid/${path}`, { signal: AbortSignal.timeout(LIMITS.timeoutMs) }),
  );
  const content = await readBounded(response, LIMITS.outputBytes);
  if (response.status !== 200 || content !== site.assets[path])
    throw new Error("Served asset verification failed");
  const type = path.endsWith(".html")
    ? "text/html"
    : path.endsWith(".css")
      ? "text/css"
      : "text/javascript";
  return new Response(content, {
    headers: {
      "content-type": `${type}; charset=utf-8`,
      "cache-control": "public,max-age=31536000,immutable",
      "x-content-type-options": "nosniff",
      "x-source-revision": site.revision,
      "x-site-digest": site.assetDigest,
      "content-security-policy":
        "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });
}
