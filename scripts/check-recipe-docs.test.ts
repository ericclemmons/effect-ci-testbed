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
  const matrix = root.split("## Recipes by feature\n")[1]?.split("The Dynamic Worker slice")[0];
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
    plannedSites.find((line) => line.includes("without a build"))!.endsWith("✅ · containerless |"),
  );
  assert.ok(
    plannedSites
      .find((line) => line.includes("](./examples/containerless-site)"))!
      .endsWith("✅ · containerless |"),
  );
});

test("each recipe opens with a focused question", () => {
  for (const recipe of recipes) {
    const readme = readFileSync(join("examples", recipe, "README.md"), "utf8");
    const question = readme.match(/^> .*(?:\n> .*)*/m)?.[0];
    assert.ok(question?.includes("?"), `${recipe} needs its opening question`);
  }
});

test("every recipe reserves honest video and measured verification slots", () => {
  for (const recipe of recipes) {
    const readme = readFileSync(join("examples", recipe, "README.md"), "utf8");
    assert.equal((readme.match(/^## Verification proof$/gm) ?? []).length, 1, recipe);
    assert.match(readme, /\*\*Video:\*\* (?:Pending|\[[^\]]+\]\([^)]+\))/, recipe);
    assert.match(readme, /\*\*Measured results:\*\* (?:Pending|\[[^\]]+\]\([^)]+\))/, recipe);
    assert.ok(readme.includes("../PROOF-PAGES.md"), recipe);
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
