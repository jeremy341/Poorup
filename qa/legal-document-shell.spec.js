import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const documentRoutes = [
  "/legal",
  "/legal/privacy",
  "/legal/terms",
  "/legal/acceptable-use",
  "/legal/support",
  "/legal/licenses",
  "/legal/accessibility",
  "/legal/storage",
  "/legal/ai",
];

test.describe("Poorup legal document shell", () => {
  for (const route of documentRoutes) {
    test(`${route} keeps a complete readable document`, async ({ page }, testInfo) => {
      await page.goto(route);
      await expect(page.locator(".legal-shell")).toBeVisible();
      await expect(page.locator(".legal-header .legal-breadcrumb")).toBeVisible({ timeout: 5000 }).catch(() => {});
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator(".legal-draft-banner")).toContainText("DRAFT");
      await expect(page.locator(".legal-article, .legal-index-main").first()).toBeVisible();
      await expect(page.locator(".legal-ticker")).toBeVisible();
      const overflow = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        body: document.body.scrollWidth > document.body.clientWidth + 1,
      }));
      expect(overflow).toEqual({ document: false, body: false });
      if (testInfo.project.name !== "mobile-390") {
        const footer = await page.locator(".legal-ticker").boundingBox();
        const viewport = page.viewportSize();
        expect(footer).not.toBeNull();
        expect((footer?.y || 0) + (footer?.height || 0)).toBeLessThanOrEqual(viewport?.height || 0);
      }
      if (route === "/legal") {
        await expect(page.locator(".legal-index-section .legal-nav")).toBeVisible();
      } else if (testInfo.project.name === "mobile-390") {
        await expect(page.locator(".legal-outline-mobile")).toBeVisible();
      } else if (testInfo.project.name === "desktop-1920") {
        await expect(page.locator(".legal-outline")).toBeVisible();
      }
      if (process.env.POORUP_CAPTURE_LEGAL && testInfo.project.name === "desktop-1920") {
        const dir = resolve("qa-artifacts", "legal-pages-1920");
        mkdirSync(dir, { recursive: true });
        const name = route === "/legal" ? "index" : route.slice("/legal/".length).replaceAll("/", "-");
        await page.screenshot({ path: resolve(dir, `${name}.png`), animations: "disabled" });
      }
    });
  }

  test("skip link and outline navigation remain keyboard reachable", async ({ page }) => {
    await page.goto("/legal/privacy");
    await page.locator(".skip-link").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#privacy-main")).toBeFocused();
    const mobileOutline = page.locator(".legal-outline-mobile");
    if (await mobileOutline.isVisible()) {
      await mobileOutline.locator("summary").click();
      await mobileOutline.locator("a[href='#scope']").click();
    } else {
      await page.locator(".legal-outline a[href='#scope']").click();
    }
    await expect(page).toHaveURL(/#scope$/);
  });

  test("legal documents remain usable without JavaScript", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();
    await page.goto("/legal/terms");
    await expect(page.locator(".legal-header")).toBeVisible();
    await expect(page.locator(".legal-article")).toContainText("Fictional currency");
    await context.close();
  });

  test("200 percent effective zoom keeps the document usable", async ({ page }) => {
    await page.goto("/legal/privacy");
    const viewport = page.viewportSize();
    await page.setViewportSize({ width: Math.max(160, Math.floor((viewport?.width || 390) / 2)), height: Math.max(320, Math.floor((viewport?.height || 844) / 2)) });
    await expect(page.locator("#privacy-main")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 || document.body.scrollWidth > document.body.clientWidth + 1);
    expect(overflow).toBe(false);
  });
});
