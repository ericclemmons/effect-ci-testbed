/** Bounded, immutable public Vite demo assets; not a deployment credential or check proof. */
export const demoSiteOrigin = "https://effect-ci-demo-site.ericclemmons.workers.dev";
/** Owned host retention policy, not actor input. Old immutable revisions are never evicted. */
export const demoSiteRevisionCapacity = 256;
export const demoAssetNames = ["index.html", "app.js", "message.js"] as const;
export type DemoAssets = Record<(typeof demoAssetNames)[number], string>;
export interface DemoSite {
  revision: string;
  digest: string;
  files: Array<{ path: string; size: number; sha256: string }>;
  assets: DemoAssets;
}
export function siteRevision(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value))
    throw Error("Full revision required");
  return value;
}
export function demoAssets(value: unknown): DemoAssets {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid assets");
  if (Reflect.ownKeys(value).length !== 3) throw Error("Exactly three owned assets required");
  const result = {} as DemoAssets;
  let total = 0;
  for (const name of demoAssetNames) {
    const property = Object.getOwnPropertyDescriptor(value, name);
    if (!property || !("value" in property) || typeof property.value !== "string")
      throw Error("Invalid asset body");
    const size = new TextEncoder().encode(property.value).byteLength;
    if (size === 0 || size > 256 * 1024) throw Error("Asset limit exceeded");
    total += size;
    result[name] = property.value;
  }
  if (total > 512 * 1024) throw Error("Site limit exceeded");
  return result;
}
export async function assetHash(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function demoSite(revision: unknown, input: unknown): Promise<DemoSite> {
  const assets = demoAssets(input);
  const files = await Promise.all(
    demoAssetNames.map(async (path) => ({
      path,
      size: new TextEncoder().encode(assets[path]).byteLength,
      sha256: await assetHash(assets[path]),
    })),
  );
  return {
    revision: siteRevision(revision),
    digest: await assetHash(JSON.stringify(files)),
    files,
    assets,
  };
}
export function demoSiteUrl(site: Pick<DemoSite, "revision" | "digest">): string {
  return `${demoSiteOrigin}/r/${site.revision}/${site.digest}/index.html`;
}
export async function siteResponse(site: DemoSite, path: string, head = false): Promise<Response> {
  if (!demoAssetNames.includes(path as keyof DemoAssets))
    return new Response("Not found", { status: 404 });
  // Authorize only exact style-element bytes from this immutable HTML, never
  // inline attributes, scripts, arbitrary nonces or an unsafe-inline wildcard.
  const styleHashes: string[] = [];
  if (path === "index.html") {
    for (const match of site.assets["index.html"].matchAll(/<style>([\s\S]*?)<\/style\s*>/gi)) {
      if (styleHashes.length >= 8) throw Error("Style element limit exceeded");
      // HTML parsing normalizes these characters before CSP checks element text.
      const text = match[1]!.replace(/\r\n?/g, "\n").replace(/\0/g, "\uFFFD");
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
      styleHashes.push(`'sha256-${btoa(String.fromCharCode(...digest))}'`);
    }
  }
  return new Response(head ? null : site.assets[path as keyof DemoAssets], {
    headers: {
      "content-type": path.endsWith(".html")
        ? "text/html; charset=utf-8"
        : "text/javascript; charset=utf-8",
      "cache-control": "public, max-age=31536000, immutable",
      "content-security-policy":
        `default-src 'none'; script-src 'self'; style-src 'self'${styleHashes.length ? " " + styleHashes.join(" ") : ""}; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; connect-src 'none'`,
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "x-site-revision": site.revision,
      "x-site-digest": site.digest,
      etag: `"${site.files.find((f) => f.path === path)!.sha256}"`,
    },
  });
}
