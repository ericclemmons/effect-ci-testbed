import { cloudflare } from "@cloudflare/vite-plugin";
import { flue, flueWorkerConfig } from "@flue/vite";
import { defineConfig } from "vite";
import { generatedFlueWorkerConfig } from "../../src/index.ts";
const agents = flue();
const configure = flueWorkerConfig();
export default defineConfig({
  plugins: [...agents, cloudflare({ config: generatedFlueWorkerConfig(configure) })],
});
