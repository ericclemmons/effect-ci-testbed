import { smallChange, type SmallChangeDecision, type SmallChangeEvidence, type SmallChangePolicy } from "./small-change.ts";

/** These callbacks are host capabilities, not remote RPC inputs. The HTTP
 * adapter pins api.github.com, scopes/revokes its token and never returns it. */
export interface SmallChangeHost {
  repository: string
  appId: number
  botId: number
  policyId: string
  policy: SmallChangePolicy
  request: (path: string, method?: "GET" | "POST", body?: unknown) => Promise<any>
  verifiedChecks: (head: string) => Promise<SmallChangeEvidence["checks"]>
  /** Read completed org-owned review evidence, never invoke inference here.
   * Missing evidence means normal review. Rereads must not spend model budget. */
  readReview?: (input: { head: string; base: string; files: ReadonlyArray<{ path: string; patch?: string }> }) => Promise<SmallChangeEvidence["review"]>
}

const sha = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const rows = (value: unknown, limit = 100): any[] => { if (!Array.isArray(value) || value.length > limit) throw Error("Incomplete GitHub page"); return value; };
const prPath = (number: number) => {
  if (!positive(number)) throw Error("Invalid PR number");
  return `/pulls/${number}`;
};

/** Bounded canonical reader. History may undercount, never invent experience.
 * A missing receipt is a normal-review result, not a successful remote check. */
export async function readSmallChange(host: SmallChangeHost, number: number): Promise<SmallChangeEvidence> {
  const path = prPath(number), pr = await host.request(path);
  if (pr.number !== number || pr.base?.repo?.full_name !== host.repository ||
    pr.head?.repo?.full_name !== host.repository || !sha(pr.head?.sha) || !sha(pr.base?.sha) ||
    !positive(pr.user?.id) || !positive(pr.changed_files)) throw Error("PR identity is not enrolled");
  // Pin the diff to immutable SHAs. /pulls/:number/files can move independently
  // of the metadata read, even if a branch is force-pushed away and back.
  const comparison = await host.request(`/compare/${pr.base.sha}...${pr.head.sha}?per_page=1`);
  if (comparison.base_commit?.sha !== pr.base.sha) throw Error("Comparison base does not match PR");
  const files = rows(comparison.files, 300);
  const complete = files.length === pr.changed_files && files.every(file =>
    typeof file.filename === "string" && ["added", "modified", "removed", "renamed", "copied", "changed"].includes(file.status) &&
    Number.isSafeInteger(file.additions) && Number.isSafeInteger(file.deletions) &&
    (file.status !== "renamed" || typeof file.previous_filename === "string"));
  const changed = files.flatMap(file => [
    { path: file.filename, additions: file.additions, deletions: file.deletions },
    // Both ends of a rename participate in sensitive/shared-path exclusions.
    ...(file.status === "renamed" ? [{ path: file.previous_filename, additions: 0, deletions: 0 }] : []),
  ]);
  const services = new Set(changed.map(file => host.policy.service(file.path)).filter((s): s is string => !!s));
  const experience: Record<string, number[]> = Object.fromEntries([...services].map(s => [s, []]));
  let examined = 0;
  history: for (let page = 1; page <= 3 && services.size; page++) {
    const history = rows(await host.request(`/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`));
    for (const old of history) {
      if (!old.merged_at || old.user?.id !== pr.user.id || old.number === number || !positive(old.number) ||
        old.base?.repo?.full_name !== host.repository) continue;
      if (++examined > 30) break history;
      const priorFiles = rows(await host.request(`${prPath(old.number)}/files?per_page=100`));
      for (const service of services) {
        if (priorFiles.some(file => typeof file.filename === "string" && host.policy.service(file.filename) === service))
          experience[service]!.push(old.number);
      }
      if ([...services].every(service => new Set(experience[service]).size >= host.policy.minMergedPullRequests)) break history;
    }
    if (history.length < 100) break;
  }
  const reviewInput = { head: pr.head.sha, base: pr.base.sha, files: files.map(file => ({ path: file.filename, patch: file.patch })) };
  // Do not evaluate Markdown or ask a model to establish a README-only policy.
  const docs = complete && files.every(file => ["added", "modified", "removed"].includes(file.status) &&
    typeof file.patch === "string" && file.patch.length > 0 && /(^|\/)README\.md$/i.test(file.filename) &&
    !file.filename.split("/").some((part: string) => part.startsWith(".")));
  const review: SmallChangeEvidence["review"] = docs
    ? { head: pr.head.sha, base: pr.base.sha, complete: true, kind: "documentation-policy", findings: [] }
    : host.readReview ? await host.readReview(reviewInput)
    : { head: pr.head.sha, base: pr.base.sha, complete: false, kind: "ai", findings: [] };
  return { head: pr.head.sha, base: pr.base.sha, open: pr.state === "open", draft: pr.draft !== false,
    complete, files: changed, checks: await host.verifiedChecks(pr.head.sha), review, experience };
}

export interface SmallChangeOperation {
  state: "pending" | "complete"
  marker: string
  decision: SmallChangeDecision
  checkId?: number
  reviewId?: number
}
export interface SmallChangeStore {
  read: (key: string) => Promise<SmallChangeOperation | undefined>
  claim: (key: string, value: SmallChangeOperation) => Promise<boolean>
  complete: (key: string, value: SmallChangeOperation) => Promise<void>
}

const validateHost = (host: SmallChangeHost) => {
  if (!/^[\w.-]+\/[\w.-]+$/.test(host.repository) || !positive(host.appId) || !positive(host.botId) ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(host.policyId)) throw Error("Invalid host review enrollment");
};

/** Publish a verdict from the trusted org workflow, not an incoming PR payload.
 * This capability owns fresh evidence, scoped writes and uncertain-ACK recovery;
 * the workflow owns the policy decision. No merge capability is supplied. */
export async function publishSmallChange(host: SmallChangeHost, number: number, store: SmallChangeStore,
  before: SmallChangeEvidence, decision: SmallChangeDecision) {
  validateHost(host);
  if (!decision || typeof decision.eligible !== "boolean" || decision.head !== before.head || decision.base !== before.base ||
    !Array.isArray(decision.reasons) || decision.reasons.some(reason => typeof reason !== "string" || !reason.length) ||
    (decision.eligible && (!before.open || before.draft || !before.complete || decision.reasons.length > 0)))
    throw Error("Invalid workflow approval decision");
  const canonical = JSON.stringify(before);
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(
    JSON.stringify([host.repository, number, host.policyId, canonical, decision]))))].map(b => b.toString(16).padStart(2, "0")).join("");
  const marker = `effect-ci-small-change:${host.policyId}:${hash}`;
  const stored = await store.read(marker);
  if (stored && (stored.marker !== marker || JSON.stringify(stored.decision) !== JSON.stringify(decision) ||
    !["pending", "complete"].includes(stored.state))) throw Error("Invalid review journal");
  if (stored?.state === "complete") return stored;
  const path = prPath(number);
  const findCheck = async () => {
    const page = await host.request(`/commits/${before.head}/check-runs?per_page=100&filter=all&check_name=small-change&app_id=${host.appId}`);
    if (!Number.isSafeInteger(page.total_count) || page.total_count > 100 || !Array.isArray(page.check_runs) || page.check_runs.length !== page.total_count)
      throw Error("Cannot reconcile incomplete check history");
    const matches = page.check_runs.filter((check: any) => check.external_id === marker && check.app?.id === host.appId &&
      check.head_sha === before.head && check.name === "small-change" && check.status === "completed" &&
      check.conclusion === (decision.eligible ? "success" : "neutral"));
    if (matches.length > 1) throw Error("Ambiguous small-change check");
    return matches[0];
  };
  const findReview = async () => {
    const reviews = rows(await host.request(`${path}/reviews?per_page=100`));
    if (reviews.length === 100) throw Error("Cannot reconcile incomplete review history");
    const matches = reviews.filter(review => review.user?.id === host.botId && review.user?.type === "Bot" &&
      review.commit_id === before.head && review.state === "APPROVED" && review.body?.endsWith(`<!-- ${marker} -->`));
    if (matches.length > 1) throw Error("Ambiguous small-change review");
    return matches[0];
  };
  if (stored) {
    const check = await findCheck(), review = decision.eligible ? await findReview() : undefined;
    if (!positive(check?.id) || (decision.eligible && !positive(review?.id)))
      throw Error("Small-change write is uncertain; retained without retry");
    const reconciled: SmallChangeOperation = { state: "complete", marker, decision, checkId: check.id,
      ...(review ? { reviewId: review.id } : {}) };
    await store.complete(marker, reconciled);
    return reconciled;
  }
  // Fresh evidence immediately before reserving a side effect. The host writer
  // uses commit_id, and GitHub rules dismiss stale approvals after later pushes.
  if (canonical !== JSON.stringify(await readSmallChange(host, number))) throw Error("PR changed; no review published");
  const pending: SmallChangeOperation = { state: "pending", marker, decision };
  if (!await store.claim(marker, pending)) throw Error("Small-change operation already claimed");
  const body = decision.eligible ? "Small change: verified checks and org review passed." : decision.reasons.join("\n").slice(0, 60_000);
  const check = await host.request("/check-runs", "POST", { name: "small-change", head_sha: before.head,
    external_id: marker, status: "completed", conclusion: decision.eligible ? "success" : "neutral",
    output: { title: decision.eligible ? "Small change" : "Normal review required", summary: body } });
  if (!positive(check?.id) || check.head_sha !== before.head || check.external_id !== marker ||
    check.app?.id !== host.appId || check.name !== "small-change" || check.status !== "completed" ||
    check.conclusion !== (decision.eligible ? "success" : "neutral")) throw Error("Small-change check acknowledgement uncertain");
  const review = decision.eligible ? await host.request(`${path}/reviews`, "POST", {
    commit_id: before.head, event: "APPROVE", body: `${body}\n\n<!-- ${marker} -->`,
  }) : undefined;
  if (decision.eligible && (!positive(review?.id) || review.commit_id !== before.head || review.state !== "APPROVED" ||
    review.user?.id !== host.botId || review.user?.type !== "Bot" || !review.body?.endsWith(`<!-- ${marker} -->`)))
    throw Error("Small-change review acknowledgement uncertain");
  const completed: SmallChangeOperation = { state: "complete", marker, decision, checkId: check.id,
    ...(review ? { reviewId: review.id } : {}) };
  await store.complete(marker, completed);
  return completed;
}

/** Compatibility composition. New org workflows can inspect, review and publish
 * as ordinary CI actions without moving policy into the host writer. */
export async function runSmallChange(host: SmallChangeHost, number: number, store: SmallChangeStore) {
  validateHost(host);
  const evidence = await readSmallChange(host, number);
  return publishSmallChange(host, number, store, evidence, smallChange(evidence, host.policy));
}
