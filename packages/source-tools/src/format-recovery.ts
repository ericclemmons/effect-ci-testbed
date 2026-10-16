import * as prettier from "prettier/standalone";
import estree from "prettier/plugins/estree";
import typescript from "prettier/plugins/typescript";

/** Host-selected, in-memory regular-file snapshot; no project configuration or plugins. */
export type FormatSnapshot = Readonly<Record<string, string>>;
export interface FormatRecovery {
  readonly before: FormatSnapshot;
  readonly after: FormatSnapshot;
  readonly changed: readonly string[];
  readonly formatter: "prettier@3.6.2";
}
const reject = () => new Error("Formatting recovery rejected");
function snapshot(input: FormatSnapshot): Record<string, string> {
  if (
    !input ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    throw reject();
  const keys = Reflect.ownKeys(input);
  if (!keys.length || keys.length > 32) throw reject();
  const result: Record<string, string> = Object.create(null);
  let size = 0;
  for (const path of keys) {
    if (
      typeof path !== "string" ||
      !/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:ts|js|json)$/.test(path)
    )
      throw reject();
    const field = Object.getOwnPropertyDescriptor(input, path);
    if (!field || !("value" in field) || typeof field.value !== "string")
      throw reject();
    const bytes = new TextEncoder().encode(field.value).length;
    if (bytes > 256 * 1024 || (size += bytes) > 512 * 1024) throw reject();
    result[path] = field.value;
  }
  return result;
}
async function fixedFormat(path: string, source: string): Promise<string> {
  return prettier.format(source, {
    parser: path.endsWith(".json") ? "json" : "typescript",
    plugins: [estree, typescript],
    semi: true,
    singleQuote: false,
    tabWidth: 2,
    useTabs: false,
    printWidth: 80,
    endOfLine: "lf",
  });
}

/** A parse failure aborts the entire recovery. This is not a semantic repair. */
export async function prepareFormatRecovery(
  input: FormatSnapshot,
): Promise<FormatRecovery> {
  const before = snapshot(input);
  const after: Record<string, string> = Object.create(null);
  const changed: string[] = [];
  for (const path of Object.keys(before).sort()) {
    after[path] = await fixedFormat(path, before[path]!);
    if (after[path] !== before[path]) changed.push(path);
  }
  return Object.freeze({
    before: Object.freeze(before),
    after: Object.freeze(after),
    changed: Object.freeze(changed),
    formatter: "prettier@3.6.2",
  });
}

/** Recompute from trusted base bytes, never trust a caller's claimed plan/pass flag.
 * Candidate must be independently read at the exact commit, including all base paths.
 * Functional/lint checks and ref-drift checks remain required before PR creation.
 */
export async function verifyFormatRecovery(
  base: FormatSnapshot,
  candidate: FormatSnapshot,
): Promise<FormatRecovery> {
  const expected = await prepareFormatRecovery(base);
  const actual = snapshot(candidate);
  if (
    !expected.changed.length ||
    JSON.stringify(Object.keys(actual).sort()) !==
      JSON.stringify(Object.keys(expected.after).sort())
  )
    throw reject();
  for (const path of Object.keys(actual)) {
    if (
      actual[path] !== expected.after[path] ||
      (await fixedFormat(path, actual[path]!)) !== actual[path]
    )
      throw reject();
  }
  return expected;
}

/** Deployment-authored capabilities, never project/model-supplied callbacks.
 * The host owns enrollment, credentials, create-only mutation intents, immutable
 * commit reads, native checks and base/head drift fences. Nothing retries here.
 */
export interface FormatRecoveryHost {
  createCandidate(files: FormatSnapshot): Promise<string>;
  readCandidate(commit: string): Promise<FormatSnapshot>;
  verifyCommit(
    commit: string,
  ): Promise<{ commit: string; passed: boolean; evidenceId: string }>;
  assertCurrent(commit: string): Promise<void>;
  propose(commit: string, evidenceId: string): Promise<{ url: string }>;
}
export async function runFormatRecovery(
  base: FormatSnapshot,
  host: FormatRecoveryHost,
) {
  const plan = await prepareFormatRecovery(base);
  if (!plan.changed.length)
    return { status: "clean" as const, changed: plan.changed };
  const commit = await host.createCandidate(plan.after);
  if (!/^[a-f0-9]{40}$/.test(commit)) throw reject();
  await verifyFormatRecovery(plan.before, await host.readCandidate(commit));
  const verification = await host.verifyCommit(commit);
  if (
    verification.commit !== commit ||
    verification.passed !== true ||
    typeof verification.evidenceId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(verification.evidenceId)
  )
    throw reject();
  // Re-read after execution: do not create a PR if the verifier/working copy
  // changed bytes or if a host-observed base/head ref drifted during the check.
  await verifyFormatRecovery(plan.before, await host.readCandidate(commit));
  await host.assertCurrent(commit);
  const proposal = await host.propose(commit, verification.evidenceId);
  return {
    status: "proposed" as const,
    commit,
    changed: plan.changed,
    evidenceId: verification.evidenceId,
    url: proposal.url,
  };
}
