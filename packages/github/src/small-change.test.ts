import assert from "node:assert/strict";
import test from "node:test";
import { approveSmallChange, smallChange, type SmallChangeEvidence, type SmallChangePolicy } from "./small-change.ts";

const head = "a".repeat(40), base = "b".repeat(40);
const policy: SmallChangePolicy = { maxChangedLines: 1000, maxServices: 1, minMergedPullRequests: 10,
  requiredChecks: ["test", "build"], service: path => path === "README.md" || path.startsWith("examples/demo/") ? "demo" : undefined };
const evidence: SmallChangeEvidence = { head, base, open: true, draft: false, complete: true,
  files: [{ path: "README.md", additions: 2, deletions: 1 }],
  checks: ["test", "build"].map(name => ({ name, head, conclusion: "success" })),
  review: { head, base, complete: true, kind: "documentation-policy", findings: [] },
  experience: { demo: Array.from({ length: 10 }, (_, i) => i + 1) } };

test("even a permissive trusted rule cannot bypass complete canonical diff and readiness guards", () => {
  let evaluations = 0;
  const rule = () => { evaluations++; return true; };
  for (const change of [
    {head:"unknown"}, {base:"unknown"}, {complete:false}, {open:false}, {draft:true}, {files:[]},
    {files:[...evidence.files,...evidence.files]},
    ...["../README.md","/README.md","a\\README.md","a//README.md","README.md\n"].map(path=>({files:[{path,additions:1,deletions:0}]})),
    {files:[{path:"README.md",additions:NaN,deletions:0}]},
  ]) assert.equal(smallChange({...evidence,...change},rule).eligible,false);
  assert.equal(evaluations,0,"Invalid evidence must not reach the selected rule");
  assert.equal(smallChange(evidence,rule).eligible,true);
  assert.equal(evaluations,1);
});

test("README approval uses existing exact-head checks and deterministic review, not an agent", async () => {
  let writes = 0;
  const result = await approveSmallChange({ policy, read: async () => structuredClone(evidence),
    publish: async result => { writes++; assert.equal(result.eligible, true); assert.equal(result.head, head); } });
  assert.equal(writes, 1);
  assert.deepEqual(result.reasons, []);
  assert.equal(smallChange({ ...evidence, files: [{ path: "examples/demo/app.ts", additions: 8, deletions: 3 }],
    review: { ...evidence.review, kind: "ai" } }, policy).eligible, true);
});

test("size, experience, protected paths and missing/stale review route to normal review", () => {
  const misses: Partial<SmallChangeEvidence>[] = [
    { files: [{ path: "README.md", additions: 999, deletions: 1 }] },
    { files: [{ path: "packages/shared.ts", additions: 1, deletions: 0 }] },
    { files: [{ path: "AGENTS.md", additions: 1, deletions: 0 }] },
    { files: [{ path: "../README.md", additions: 1, deletions: 0 }] },
    { files: [{ path: "README.md", additions: -1, deletions: 0 }] },
    { experience: { demo: Array(10).fill(1) } }, { experience: {} }, { complete: false }, { draft: true },
    { checks: [] }, { checks: [...evidence.checks, evidence.checks[0]!] },
    { checks: evidence.checks.map(c => ({ ...c, head: base })) },
    { checks: evidence.checks.map(c => ({ ...c, conclusion: "failure" })) },
    { review: { ...evidence.review, complete: false } },
    { review: { ...evidence.review, base: head } },
    ...(["P0", "P1", "P2"] as const).map(priority => ({ review: { ...evidence.review, findings: [{ priority }] } })),
  ];
  for (const change of misses) assert.equal(smallChange({ ...evidence, ...change }, policy).eligible, false, JSON.stringify(change));
  assert.equal(smallChange({ ...evidence, files: [{ path: "README.md", additions: 998, deletions: 1 }] }, policy).eligible, true);
  assert.equal(smallChange({ ...evidence, files: [{ path: "examples/demo/a.ts", additions: 1, deletions: 0 },
    { path: "apps/other/b.ts", additions: 1, deletions: 0 }], review: { ...evidence.review, kind: "ai" },
    experience: { demo: evidence.experience.demo!, other: evidence.experience.demo! } },
    { ...policy, service: path => path.startsWith("apps/other/") ? "other" : "demo" }).eligible, false);
});

test("moving PR or check/review evidence cannot publish a stale approval", async () => {
  for (const change of [{ head: base }, { base: head }, { checks: [] }, { open: false }]) {
    let reads = 0;
    await assert.rejects(approveSmallChange({ policy, read: async () => ++reads === 1 ? structuredClone(evidence) : { ...evidence, ...change },
      publish: async () => assert.fail("Must not publish stale decision") }), /changed/);
  }
});
