import { cloudflare } from "@cloudflare/vite-plugin";
import { flue, flueWorkerConfig } from "@flue/vite";
import { defineConfig } from "vite";
import { generatedFlueWorkerConfig } from "@effect-ci-testbed/flue-cloudflare-config";
const agents = flue();
const configure = flueWorkerConfig();
export default defineConfig({
  plugins: [...agents, cloudflare({ config: generatedFlueWorkerConfig(configure) })],
});
