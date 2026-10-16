import type { GitHubAppCredentials } from "../../../packages/github/src/app.ts";
import { withDemoEvidenceRead } from "./demo-evidence-reader.ts";
import { readStaticAssetsGitHub } from "../../../packages/cloudflare/src/static-assets-github.ts";

export async function readOwnedStaticAssets(credentials: GitHubAppCredentials, revision: string, transport: typeof fetch = fetch) {
  if (typeof revision !== "string" || !/^[a-f0-9]{40}$/.test(revision)) throw Error("Invalid static source revision");
  let result: Awaited<ReturnType<typeof readStaticAssetsGitHub>> | undefined;
  try {
    await withDemoEvidenceRead(credentials, async request => {
      result = await readStaticAssetsGitHub(revision, request);
      return true;
    }, transport);
    // The capability's revocation finally block has succeeded before returning source.
    if (!result) throw Error("Unavailable");
    return { revision: result.revision, manifestDigest: result.manifestDigest, bytes: new Uint8Array(result.bytes) };
  } catch { throw Error("Static source read unavailable"); }
}
