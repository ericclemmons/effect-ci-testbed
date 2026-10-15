import { WorkerEntrypoint } from "cloudflare:workers";
import { readOwnedStaticAssets } from "./static-assets-read.ts";

/** Private fixed-repository reader. Uses existing host credentials, never returns a token. */
export class StaticAssetSourceReader extends WorkerEntrypoint<{ GITHUB_APP_ID: string; GITHUB_PRIVATE_KEY: string }> {
  async read(revision: string) {
    return readOwnedStaticAssets({ appId: this.env.GITHUB_APP_ID, privateKey: this.env.GITHUB_PRIVATE_KEY }, revision);
  }
  fetch() { return new Response("Not found", { status: 404 }); }
}
