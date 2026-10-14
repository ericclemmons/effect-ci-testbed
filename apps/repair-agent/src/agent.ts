"use agent";
import { useModel, useResponseFinish } from "@flue/runtime";
import { getCloudflareContext } from "@flue/runtime/cloudflare";
import { MODEL } from "@effect-ci-testbed/flue-budget-provider/protocol";
export function OwnedRepairProposal() {
  useModel(`cloudflare/${MODEL}`, { compaction: false });
  useResponseFinish(() => {
    const rows = getCloudflareContext()
      .storage.sql.exec("SELECT reservation FROM effect_ci_model_slots_v1")
      .toArray();
    if (rows.length !== 1 || typeof rows[0].reservation !== "string")
      throw new Error("Owned proposal slot unavailable");
    return { reservationId: rows[0].reservation, proposalOnly: true };
  });
  return "Propose only the corrected JavaScript function for this owned fixture: export function healthStatus() { return 500; }. The test expects healthStatus() === 200. Return only the function, no Markdown, explanation, delegation or tools. You cannot execute code, access credentials, write GitHub or deploy.";
}
OwnedRepairProposal.durability = { maxAttempts: 1, timeoutMs: 65_000 };
