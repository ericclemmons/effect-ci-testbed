import { Hono } from "hono";
import { init, setProvider } from "@flue/runtime";
import { getCloudflareContext } from "@flue/runtime/cloudflare";
import { cloudflareBindingProvider } from "@flue/runtime/cloudflare/workers-ai";
import { OwnedProposal } from "./agent.ts";
const model = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const body =
  'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\ndata: [DONE]\n\n';
const provider = cloudflareBindingProvider({
  gateway: false,
  binding: {
    async run() {
      const sql = getCloudflareContext().storage.sql;
      sql.exec("CREATE TABLE IF NOT EXISTS owned_fake_calls (id INTEGER PRIMARY KEY)");
      // A second call would fail, not silently return another fake response.
      sql.exec("INSERT INTO owned_fake_calls VALUES (1)");
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    },
  },
});
const fixed = provider.getModels().filter((entry) => entry.id === model);
setProvider({ ...provider, getModels: () => fixed, filterModels: () => fixed });
const app = new Hono();
app.post("/owned-fake-probe", async (c) => {
  const handle = init(OwnedProposal, { id: "owned-lab" });
  const input = await c.req.json();
  if (input.mode === "read")
    return c.json({
      fakeInference: true,
      reply: await handle.read(input.receipt, { signal: AbortSignal.timeout(10000) }),
    });
  if (input.mode !== "run") return c.json({ error: "test mode required" }, 400);
  const receipt = await handle.dispatch("Reply only OK.");
  const reply = await handle.read(receipt, { signal: AbortSignal.timeout(10000) });
  return c.json({ fakeInference: true, receipt, reply });
});
export default app;
