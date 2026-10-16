import { test } from "@e2e-dev/web";
import { expect } from "e2e";

test("records the intentional wrong-expectation failure", async ({ app, screen }) => {
  await app.open("/");
  await screen.getByRole("button", "Test JavaScript").click();
  await expect(screen.getByRole("status")).toHaveText("Intentionally not the build output");
});
