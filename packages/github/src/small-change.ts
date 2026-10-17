/** PR-only org policy. Inputs come from trusted host readers/verifiers, never
 * from a PR label, repository script output or an unverified receipt payload. */
export interface SmallChangeEvidence {
  readonly head: string
  readonly base: string
  readonly open: boolean
  readonly draft: boolean
  readonly complete: boolean
  readonly files: ReadonlyArray<{ path: string; additions: number; deletions: number }>
  readonly checks: ReadonlyArray<{ name: string; head: string; conclusion: string }>
  readonly review: {
    head: string
    base: string
    complete: boolean
    kind: "ai" | "documentation-policy"
    findings: ReadonlyArray<{ priority: "P0" | "P1" | "P2" | "P3" }>
  }
  /** Canonical merged PR history for this author, grouped by affected service.
   * IDs are deduplicated here. An absent service is unknown, not experienced. */
  readonly experience: Readonly<Record<string, ReadonlyArray<number>>>
}

export interface SmallChangePolicy {
  readonly maxChangedLines: number
  readonly maxServices: number
  readonly minMergedPullRequests: number
  readonly requiredChecks: ReadonlyArray<string>
  /** Host-owned mapping. Undefined excludes shared, sensitive or unknown paths. */
  readonly service: (path: string) => string | undefined
}

export interface SmallChangeDecision {
  readonly eligible: boolean
  readonly reasons: ReadonlyArray<string>
  readonly head: string
  readonly base: string
}

export function smallChange(evidence: SmallChangeEvidence, policy: SmallChangePolicy): SmallChangeDecision {
  if (![policy.maxChangedLines, policy.maxServices, policy.minMergedPullRequests]
    .every(n => Number.isSafeInteger(n) && n > 0) || !policy.requiredChecks.length ||
    new Set(policy.requiredChecks).size !== policy.requiredChecks.length)
    throw Error("Invalid small-change policy");
  const reasons: string[] = [];
  if (!/^[a-f0-9]{40}$/.test(evidence.head) || !/^[a-f0-9]{40}$/.test(evidence.base) ||
    !evidence.open || evidence.draft || !evidence.complete || !evidence.files.length)
    reasons.push("Complete, ready PR evidence is required.");
  const services = new Set<string>(), paths = new Set<string>();
  let lines = 0;
  for (const file of evidence.files) {
    if (!file.path || file.path.startsWith("/") || file.path.includes("\\") ||
      /[\x00-\x1f\x7f]/.test(file.path) || file.path.split("/").some(p => !p || p === "." || p === "..") ||
      paths.has(file.path) || ![file.additions, file.deletions].every(n => Number.isSafeInteger(n) && n >= 0)) {
      reasons.push("Invalid or incomplete changed-file evidence.");
      continue;
    }
    paths.add(file.path);
    lines += file.additions + file.deletions;
    const service = policy.service(file.path);
    if (!service) reasons.push(`Normal review required: ${file.path}`);
    else services.add(service);
  }
  // Strictly less than the threshold, as in the article; count additions AND deletions.
  if (!Number.isSafeInteger(lines) || lines >= policy.maxChangedLines)
    reasons.push(`Change must be below ${policy.maxChangedLines} changed lines.`);
  if (services.size > policy.maxServices) reasons.push("Too many affected services.");
  for (const service of services) {
    const history = Object.hasOwn(evidence.experience, service) ? evidence.experience[service] : undefined;
    if (!history || history.some(id => !Number.isSafeInteger(id) || id < 1) ||
      new Set(history).size < policy.minMergedPullRequests)
      reasons.push(`Author experience required: ${service}`);
  }
  for (const name of policy.requiredChecks) {
    const checks = evidence.checks.filter(check => check.name === name);
    if (checks.length !== 1 || checks[0]!.head !== evidence.head || checks[0]!.conclusion !== "success")
      reasons.push(`Successful exact-head check required: ${name}`);
  }
  const review = evidence.review;
  if (!review.complete || review.head !== evidence.head || review.base !== evidence.base ||
    !["ai", "documentation-policy"].includes(review.kind) ||
    review.findings.some(finding => finding.priority !== "P3"))
    reasons.push("Complete exact-head/base review with no P0/P1/P2 findings required.");
  // Markdown is not inherently inert. This is intentionally narrower than *.md.
  if (review.kind === "documentation-policy" && evidence.files.some(file =>
    !/(^|\/)README\.md$/i.test(file.path) || file.path.split("/").some(p => p.startsWith("."))))
    reasons.push("Documentation policy only covers README changes.");
  return { eligible: reasons.length === 0, reasons, head: evidence.head, base: evidence.base };
}

/** Host publishes a check on every PR; approves only eligible PRs. Ineligible
 * changes continue through normal review, without a synthetic rejection.
 * Writer owns idempotency/reconciliation. No merge capability is supplied. */
export async function approveSmallChange(options: {
  policy: SmallChangePolicy
  read: () => Promise<SmallChangeEvidence>
  publish: (decision: SmallChangeDecision) => Promise<void>
}): Promise<SmallChangeDecision> {
  const before = await options.read();
  const canonical = JSON.stringify(before);
  const decision = smallChange(before, options.policy);
  const after = await options.read();
  if (canonical !== JSON.stringify(after)) throw Error("PR evidence changed; no approval published");
  await options.publish(decision);
  return decision;
}
