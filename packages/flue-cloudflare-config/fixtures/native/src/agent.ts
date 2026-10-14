"use agent";
import { useModel, useResponseFinish } from "@flue/runtime";
import { getCloudflareContext } from "@flue/runtime/cloudflare";
export function OwnedProposal() {
  useModel("cloudflare/@cf/meta/llama-3.3-70b-instruct-fp8-fast", { compaction: false });
  useResponseFinish(() => ({
    fakeCalls: getCloudflareContext()
      .storage.sql.exec("SELECT COUNT(*) AS n FROM owned_fake_calls")
      .toArray()[0].n,
  }));
  return "Reply only OK. No tools.";
}
OwnedProposal.durability = { maxAttempts: 1, timeoutMs: 5000 };
