import assert from "node:assert/strict";
import test from "node:test";
import { publishSmallChange, readSmallChange, runSmallChange, type SmallChangeHost, type SmallChangeOperation } from "./small-change-host.ts";

const head = "a".repeat(40), base = "b".repeat(40), repository = "owner/demo";
function fixture() {
  const journal = new Map<string, SmallChangeOperation>(), checks: any[] = [], reviews: any[] = [];
  let writes = 0, reads = 0, lost = "", changed = false, code = false;
  const host: SmallChangeHost = {
    repository, appId: 12, botId: 34, policyId: "demo-v1",
    policy: { maxChangedLines: 1000, maxServices: 1, minMergedPullRequests: 10,
      requiredChecks: ["test", "build"], service: path => path === "README.md" || path === "app.ts" ? "demo" : undefined },
    verifiedChecks: async () => ["test", "build"].map(name => ({ name, head, conclusion: "success" })),
    readReview: async () => assert.fail("README review needs no separate reviewer"),
    request: async (path, method = "GET", body: any) => {
      if (method === "POST") {
        writes++;
        if (path === "/check-runs") {
          const result = { ...body, id: 1, app: { id: 12 } }; checks.push(result);
          if (lost === "check") throw Error("lost check ACK");
          return result;
        }
        assert.equal(path, "/pulls/50/reviews");
        const result = { ...body, state: "APPROVED", id: 2, user: { id: 34, type: "Bot" } }; reviews.push(result);
        if (lost === "review") throw Error("lost review ACK");
        return result;
      }
      if (path === "/pulls/50") {
        reads++;
        return { number: 50, base: { sha: base, repo: { full_name: repository } },
          head: { sha: changed && reads > 1 ? base : head, repo: { full_name: repository } },
          user: { id: 8 }, changed_files: 1, state: "open", draft: false };
      }
      if (path.startsWith("/compare/")) {
        assert.equal(path, `/compare/${base}...${changed && reads > 1 ? base : head}?per_page=1`);
        return { base_commit: { sha: base }, files: [{ filename: code ? "app.ts" : "README.md", status: "modified", additions: 1, deletions: 1, patch: "-old\n+new" }] };
      }
      if (path.startsWith("/pulls?")) return Array.from({ length: 10 }, (_, i) => ({ number: i + 1,
        user: { id: 8 }, merged_at: "2026-10-18T00:00:00Z", base: { repo: { full_name: repository } } }));
      if (/^\/pulls\/\d+\/files/.test(path)) return [{ filename: "README.md" }];
      if (path.startsWith("/commits/")) return { total_count: checks.length, check_runs: checks };
      if (path === "/pulls/50/reviews?per_page=100") return reviews;
      throw Error(`Unexpected fixture request ${path}`);
    },
  };
  const store = {
    read: async (key: string) => journal.get(key),
    claim: async (key: string, value: SmallChangeOperation) => { if (journal.has(key)) return false; journal.set(key, value); return true; },
    complete: async (key: string, value: SmallChangeOperation) => { journal.set(key, value); },
  };
  return { host, store, checks, reviews, journal, writes: () => writes,
    lose: (operation: string) => { lost = operation; }, move: () => { changed = true; }, code: () => { code = true; } };
}

test("canonical README PR publishes an exact-head check and one bot approval; replay writes nothing", async () => {
  const f = fixture(), first = await runSmallChange(f.host, 50, f.store);
  assert.equal(first.decision.eligible, true);
  assert.equal(f.writes(), 2);
  assert.equal(f.reviews[0].commit_id, head);
  assert.equal(f.checks[0].conclusion, "success");
  assert.deepEqual(await runSmallChange(f.host, 50, f.store), first);
  assert.equal(f.writes(), 2);
});

test("a lost review ACK reconciles the same numeric bot identity; a lost check ACK never approves", async () => {
  for (const lost of ["check", "review"]) {
    const f = fixture(); f.lose(lost);
    await assert.rejects(runSmallChange(f.host, 50, f.store), /lost/);
    if (lost === "review") {
      f.reviews[0].user.login = "renamed-effect-ci-bot";
      assert.equal((await runSmallChange(f.host, 50, f.store)).state, "complete");
    } else await assert.rejects(runSmallChange(f.host, 50, f.store), /uncertain/);
    assert.equal(f.writes(), lost === "check" ? 1 : 2);
  }
});

test("missing review/remote proof becomes normal review, not rejection or automatic approval", async () => {
  const f = fixture(); f.code(); delete f.host.readReview;
  f.host.verifiedChecks = async () => [];
  const result = await runSmallChange(f.host, 50, f.store);
  assert.equal(result.decision.eligible, false);
  assert.equal(f.writes(), 1);
  assert.equal(f.checks[0].conclusion, "neutral");
  assert.equal(f.reviews.length, 0);
});

test("moving PR evidence writes nothing; unmerged or foreign author history cannot confer experience", async () => {
  const f = fixture(); f.move();
  await assert.rejects(runSmallChange(f.host, 50, f.store), /changed/);
  assert.equal(f.writes(), 0);
  for (const history of [{ merged_at: null, user: { id: 8 } }, { merged_at: "now", user: { id: 9 } }]) {
    const g = fixture(), request = g.host.request;
    g.host.request = async (path, ...args) => path.startsWith("/pulls?") ? [{ number: 1, ...history,
      base: { repo: { full_name: repository } } }] : request(path, ...args);
    const evidence = await readSmallChange(g.host, 50);
    assert.deepEqual(evidence.experience.demo, []);
  }
});

test("renames include their old sensitive path and incomplete file lists cannot use docs review", async () => {
  for (const mode of ["rename", "incomplete"]) {
    const f = fixture(), request = f.host.request; delete f.host.readReview;
    f.host.request = async (path, ...args) => path.startsWith("/compare/")
      ? { base_commit: { sha: base }, files: [{ filename: "README.md", previous_filename: "SECURITY.md", status: mode === "rename" ? "renamed" : "modified", additions: 1, deletions: 0 }] }
      : path === "/pulls/50" && mode === "incomplete" ? { ...await request(path), changed_files: 2 } : request(path, ...args);
    const result = await runSmallChange(f.host, 50, f.store);
    assert.equal(result.decision.eligible, false);
    assert.equal(f.reviews.length, 0);
  }
});

test("concurrent deliveries claim one writer; foreign acknowledgements remain pending", async () => {
  const f = fixture();
  const results = await Promise.allSettled([runSmallChange(f.host, 50, f.store), runSmallChange(f.host, 50, f.store)]);
  assert.ok(results.some(result => result.status === "fulfilled"));
  assert.equal(f.writes(), 2);
  assert.equal(f.reviews.length, 1);
  for (const field of ["app", "head_sha", "external_id"]) {
    const g = fixture(), request = g.host.request;
    g.host.request = async (path, method, body) => {
      const result = await request(path, method, body);
      return method === "POST" && path === "/check-runs" ? { ...result, [field]: field === "app" ? { id: 999 } : "foreign" } : result;
    };
    await assert.rejects(runSmallChange(g.host, 50, g.store), /acknowledgement uncertain/);
    assert.equal(g.reviews.length, 0);
    assert.equal([...g.journal.values()][0]?.state, "pending");
  }
});

test("diff reads pin both SHAs; a foreign comparison base cannot authorize a review", async () => {
  const f = fixture(), request = f.host.request;
  f.host.request = async (path, ...args) => {
    assert.notEqual(path, "/pulls/50/files?per_page=100", "Never read a moving PR file list for approval");
    const value = await request(path, ...args);
    return path.startsWith("/compare/") ? { ...value, base_commit: { sha: head } } : value;
  };
  await assert.rejects(runSmallChange(f.host, 50, f.store), /Comparison base/);
  assert.equal(f.writes(), 0);
});

test("the writer publishes the trusted workflow verdict instead of choosing org policy", async () => {
  const f = fixture(), input = await readSmallChange(f.host, 50);
  const result = await publishSmallChange(f.host, 50, f.store, input,
    { head, base, eligible: false, reasons: ["This workflow requires human review."] });
  assert.equal(result.decision.eligible, false);
  assert.equal(f.checks[0].conclusion, "neutral");
  assert.equal(f.reviews.length, 0);
});

test("workflow verdicts cannot replace canonical commits or bypass stale evidence", async () => {
  for (const stale of [false, true]) {
    const f = fixture(), input = await readSmallChange(f.host, 50);
    if (stale) f.move();
    await assert.rejects(publishSmallChange(f.host, 50, f.store, input,
      { head: stale ? head : "c".repeat(40), base, eligible: true, reasons: [] }),
    stale ? /PR changed/ : /Invalid workflow approval/);
    assert.equal(f.writes(), 0);
  }
});
