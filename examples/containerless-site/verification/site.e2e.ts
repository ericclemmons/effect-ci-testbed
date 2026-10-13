import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { REVISION } from "./native.ts";
test("the exact hosted build renders and its client counter works", async ({ app, screen }) => {
  await app.open(`/r/${REVISION}/index.html`);
  await expect(screen.getByRole("heading", "CI without the container")).toBeVisible();
  await screen.getByRole("button", "Count: 0").click();
  await expect(screen.getByRole("button", "Count: 1")).toBeVisible();
  await screen.getByRole("button", "Count: 1").click();
  await expect(screen.getByRole("button", "Count: 2")).toBeVisible();
});
