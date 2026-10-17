import { expect, it } from "vite-plus/test";

it("keeps a long assertion readable in the Slack run thread", () => {
  const actual = Array.from({ length: 48 }, (_, index) => ({
    checkpoint: `preview-checkpoint-${index}`,
    result: "actual",
  }));
  const expected = actual.map((entry) => ({ ...entry, result: "expected" }));

  // Deliberately failing, non-production presentation fixture. Never merge.
  expect(actual).toEqual(expected);
});
