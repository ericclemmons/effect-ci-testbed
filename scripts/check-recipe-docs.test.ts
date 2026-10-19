import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

const root = readFileSync("README.md", "utf8");
const guide = readFileSync("examples/README.md", "utf8");
const recipes = readdirSync("examples", { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join("examples", entry.name, "README.md")))
  .map((entry) => entry.name)
  .sort();

test("remote goal documentation describes host negotiation, not blanket rejection", () => {
  assert.doesNotMatch(root, /built-in remote runner still rejects target selection/);
  assert.match(root, /cf-ci doctor --remote/);
  assert.match(root, /host.*advertis|advertis.*host/i);
});

test("the root guide has one quick start and separates hosted proof from roadmap coverage", () => {
  assert.equal((root.match(/^## Try it locally$/gm) ?? []).length, 1);
  assert.ok(root.includes("./apps/effect-ci/TRUSTED-REMOTE.md"));
  assert.ok(root.includes("./examples/artifacts-source/README.md#verification"));
  assert.ok(root.includes("https://github.com/ericclemmons/effect-ci-testbed/issues/229"));
  assert.doesNotMatch(root, /The next containerless recipes should build on each other/);
});

test("trusted-result SDK entrypoints are discoverable without implying standalone enrollment", () => {
  const selfHost = readFileSync("apps/effect-ci/SELF-HOST.md", "utf8");
  for (const contract of ["host-attempt", "execution-receipt", "execution-journal"]) {
    const path = `packages/cloudflare/src/${contract}.md`;
    assert.ok(existsSync(path));
    assert.ok(root.includes(path));
    if (contract !== "host-attempt") assert.ok(selfHost.includes(path));
  }
  assert.match(root, /do not automatically enroll a signer/);
  assert.match(selfHost, /does not automatically enroll signing keys/);
});

test("the check-reuse guide separates current remote receipts from historical Git-note proof", () => {
  const readme = readFileSync("examples/verification-evidence/README.md", "utf8");
  assert.ok(readme.includes("../../apps/effect-ci/TRUSTED-REMOTE.md"));
  assert.match(readme, /host-issued receipts/);
  assert.match(readme, /fixed demo test suite/);
  assert.ok(readme.includes("refs/notes/effect-ci-hosted-checks-v1"));
  assert.ok(readme.includes("refs/notes/effect-ci-verification"));
  assert.doesNotMatch(readme, /It does \*\*not\*\* yet reuse lint or the test suite/);
  assert.doesNotMatch(readme, /Full test-suite reuse, the remaining/);
});

test("every runnable recipe is discoverable in the matrix and reading guide", () => {
  const matrixRecipes = [...root.matchAll(/\]\(\.\/examples\/([^/#)]+)/g)]
    .map((match) => match[1])
    .filter((path) => !path.endsWith(".md"));
  const guideRecipes = [...guide.matchAll(/\]\(\.\/([^/#)]+)/g)]
    .map((match) => match[1])
    .filter((path) => !path.endsWith(".md"));
  assert.deepEqual([...new Set(matrixRecipes)].sort(), recipes);
  assert.deepEqual([...new Set(guideRecipes)].sort(), recipes);
});

test("recipe groups have coverage tables with only explicit evidence states", () => {
  const matrix = root.split("## Recipes by feature\n")[1]?.split(/^## /m)[0];
  assert.ok(matrix);
  const groups = matrix.split(/^### /m).slice(1);
  assert.equal(groups.length, 10);
  for (const group of groups) {
    const rows = group.split("\n").filter((line) => /^\| (?!Recipe|---)/.test(line));
    assert.ok(rows.length > 0, group.split("\n")[0]);
    for (const row of rows) {
      const columns = row
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      assert.equal(columns.length, 5, row);
      assert.ok(
        columns.slice(1, 4).every((cell) => ["✅", "🔜", "—"].includes(cell)),
        row,
      );
      assert.ok(
        ["✅", "🔜", "—", "✅ · containerless", "🔜 · containerless"].includes(columns[4]),
        row,
      );
    }
  }
});

test("containerless stays a Cloudflare capability with verified and planned scope", () => {
  assert.match(root, /not another execution environment/);
  for (const recipe of ["dynamic-worker-checks", "dynamic-project-checks"]) {
    const row = root.split("\n").find((line) => line.includes(`](./examples/${recipe})`))!;
    assert.ok(row.endsWith("✅ · containerless |"), row);
  }
  const durableSource = root
    .split("\n")
    .find((line) => line.includes("](.\/examples/durable-object-source)"))!;
  assert.ok(
    !durableSource.includes("containerless"),
    "a DO ingredient does not classify its container consumer",
  );
  const plannedSites = root
    .split("\n")
    .filter(
      (line) => line.startsWith("| ") && line.includes("static") && line.includes("containerless"),
    );
  assert.equal(plannedSites.length, 2);
  assert.ok(
    plannedSites.find((line) => line.includes("](./examples/static-assets-source)"))!.endsWith("✅ · containerless |"),
  );
  assert.ok(
    plannedSites
      .find((line) => line.includes("](./examples/containerless-site)"))!
      .endsWith("✅ · containerless |"),
  );
});

test("recipe READMEs omit empty media placeholders", () => {
  for (const recipe of recipes) {
    const readme = readFileSync(join("examples", recipe, "README.md"), "utf8");
    assert.doesNotMatch(readme, /\*\*Video:\*\* Pending\.\s+\*\*Measured results:\*\* Pending\./,
      `${recipe}: omit empty proof placeholders; link evidence when it exists`);
  }
});

test("recipe names describe user tasks rather than source implementation jargon", () => {
  for (const recipe of recipes) {
    const title = readFileSync(join("examples", recipe, "README.md"), "utf8").split("\n")[0];
    assert.doesNotMatch(title, /materializ|digest-pinned|subgraph|compensation/i, recipe);
  }
  for (const [recipe, label] of [
    ["r2-source", "Checkout from R2"],
    ["artifacts-source", "Checkout from Cloudflare Artifacts"],
    ["durable-object-source", "Checkout from a Durable Object"],
    ["gitlab-source", "Checkout from GitLab"],
  ]) {
    assert.ok(root.includes(`[${label}](./examples/${recipe})`), recipe);
    assert.equal(
      readFileSync(join("examples", recipe, "README.md"), "utf8").split("\n")[0],
      `# ${label}`,
    );
  }
});

test("recipe documentation links resolve locally", () => {
  const files = [
    "README.md",
    "examples/README.md",
    ...recipes.map((recipe) => join("examples", recipe, "README.md")),
  ];
  for (const file of files) {
    const markdown = readFileSync(file, "utf8");
    for (const match of markdown.matchAll(/\]\((\.{1,2}\/[^)]+)\)/g)) {
      const path = match[1].split("#")[0];
      assert.ok(existsSync(resolve(dirname(file), path)), `${file}: ${match[1]}`);
    }
  }
});
