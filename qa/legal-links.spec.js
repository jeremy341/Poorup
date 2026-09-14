import { test, expect } from "@playwright/test";

test.describe("legal links", () => {
  test("Home exposes compact legal links without nesting interaction", async ({ page }) => {
    await page.goto("/");
    const ticker = page.locator(".ticker");
    await expect(ticker.locator("a[href='/legal#privacy']")).toHaveCount(1);
    await expect(ticker.locator("a[href='/legal#terms']")).toHaveCount(1);
    await expect(ticker.locator("a[href='/legal#support']")).toHaveCount(1);
    await expect(ticker.locator("a")).toHaveCount(3);
    await expect(ticker.locator("a button")).toHaveCount(0);
  });

  test("legal documents remain readable when JavaScript is disabled", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/privacy");
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator(".skip-link")).toHaveCount(1);
    await expect(page.locator("a[href='/']")).toHaveCount(1);
    await context.close();
  });
});
