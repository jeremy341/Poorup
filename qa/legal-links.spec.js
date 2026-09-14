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

  test("Home legal links keep a usable hit target without changing ticker rhythm", async ({ page }) => {
    await page.goto("/");
    const ticker = await page.locator(".ticker").boundingBox();
    const links = await page.locator(".legal-links a").evaluateAll((items) => items.map((item) => item.getBoundingClientRect().height));
    expect(ticker).not.toBeNull();
    expect(links).toHaveLength(3);
    links.forEach((height) => expect(height).toBeGreaterThanOrEqual(24));
    expect(ticker.height).toBeLessThan(52);
  });

  test("legal documents remain readable when JavaScript is disabled", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/privacy");
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator(".skip-link")).toHaveCount(1);
    await expect(page.locator(".legal-back[href='/']")).toHaveCount(1);
    await context.close();
  });
});
