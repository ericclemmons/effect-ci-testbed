import { test } from "@e2e-dev/web";
import { expect } from "e2e";

test("shows the generated build message", async ({ app, screen }) => {
  await app.open("/");
  await expect(screen.getByRole("heading", "Tiny Vite app")).toBeVisible();
  await screen.getByRole("button", "Show message").click();
  await expect(screen.getByRole("status")).toHaveText(/\S/);
});
