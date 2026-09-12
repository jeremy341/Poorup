import { test, expect } from "@playwright/test";

function intersects(a, b) {
  return a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

test.describe("Batch 3 responsive and accessibility contracts", () => {
  test("modal close controls keep a 40px hit height", async ({ page }) => {
    await page.goto("/");
    await page.locator("#open-create-btn").click();
    await expect.poll(() => page.locator("#rooms-modal").evaluate((el) => !el.classList.contains("is-hidden"))).toBe(true);
    const size = await page.locator("#rooms-close").evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    expect(size.width).toBeGreaterThanOrEqual(40);
    expect(size.height).toBeGreaterThanOrEqual(40);
  });

  test("mobile Rules intro keeps copy and reference metadata readable", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/?rules=book");
    await expect(page.locator(".rules-intro")).toBeVisible();
    const metrics = await page.evaluate(() => {
      const intro = document.querySelector(".rules-intro");
      const copy = document.querySelector(".rules-intro-copy");
      const meta = document.querySelector(".rules-intro-meta");
      if (!intro || !copy || !meta) return null;
      const introBox = intro.getBoundingClientRect();
      const copyBox = copy.getBoundingClientRect();
      const metaBox = meta.getBoundingClientRect();
      return { introWidth: introBox.width, copyWidth: copyBox.width, metaWidth: metaBox.width };
    });
    expect(metrics).not.toBeNull();
    expect(metrics.copyWidth).toBeGreaterThanOrEqual(180);
    expect(metrics.metaWidth).toBeGreaterThanOrEqual(300);
  });

  test("mobile Home patrol readouts do not overlap the wordmark", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    const metrics = await page.evaluate(() => {
      const title = document.querySelector("#view-home .wm-hero")?.getBoundingClientRect();
      const readouts = [".home-local-time", ".home-patrol-score", ".home-patrol-hint"]
        .map((selector) => document.querySelector(`#view-home ${selector}`)?.getBoundingClientRect())
        .filter(Boolean);
      return { title, readouts, overlap: readouts.some((box) => {
        return box.left < title.right && box.right > title.left && box.top < title.bottom && box.bottom > title.top;
      }) };
    });
    expect(metrics.overlap).toBe(false);
  });

  test("mobile text fields stay at or above 16px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    const fontSize = await page.locator("#home-alias").evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(16);
  });

  test("landscape iPad frequent controls meet 44px targets", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/");
    const sizes = await page.evaluate(() => {
      const selectors = ["#home-nav .home-nav-tab", "#sound-toggle-btn", "#music-toggle-btn", "#quick-table-btn", "#chair-edit-btn"];
      return Object.fromEntries(selectors.map((selector) => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return [selector, rect ? { width: rect.width, height: rect.height } : null];
      }));
    });
    for (const selector of ["#home-nav .home-nav-tab", "#sound-toggle-btn", "#music-toggle-btn", "#quick-table-btn", "#chair-edit-btn"]) {
      expect(sizes[selector]).not.toBeNull();
      expect(sizes[selector].height).toBeGreaterThanOrEqual(44);
    }
  });

  test("top-level destination shells expose skip and page headings", async ({ page }) => {
    await page.goto("/");
    const skipLink = page.locator(".skip-link:visible");
    await expect(skipLink).toHaveAttribute("href", "#home-main");
    await page.locator("#home-rankings-tab").click();
    await expect(page.locator("#rankings-page-content .rankings-hero")).toBeVisible();
    await expect(page.locator("#rankings-page-content")).toHaveAttribute("aria-labelledby", "rankings-page-heading");
    await expect(page.locator("#rankings-page-heading")).toHaveCount(1);
    await expect(skipLink).toHaveAttribute("href", "#rankings-page-content");
    await page.locator("#view-rankings [data-top-surface=\"social\"]").click();
    await expect(page.locator("#social-page-content .social-hero")).toBeVisible();
    await expect(page.locator("#social-page-content")).toHaveAttribute("aria-labelledby", "social-page-heading");
    await expect(page.locator("#social-page-heading")).toHaveCount(1);
    await expect(skipLink).toHaveAttribute("href", "#social-page-content");
  });

  test("mobile nav keeps a right-edge overflow cue", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    const cue = await page.locator("#view-home .home-nav").evaluate((el) => ({
      overflow: el.scrollWidth > el.clientWidth,
      mask: getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage,
    }));
    expect(cue.overflow).toBe(true);
    expect(cue.mask).not.toBe("none");
  });

  test("long event summaries wrap instead of clipping", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/");
    await expect(page.locator("#global-event-banner")).toBeAttached();
    const summary = "A long event explanation keeps the modifier understandable for narrow screens and German-length copy.";
    const metrics = await page.evaluate((copy) => {
      const banner = document.querySelector("#global-event-banner");
      const node = document.querySelector("#global-event-copy");
      if (!banner || !node) return null;
      document.querySelector("#view-game")?.classList.remove("is-hidden");
      node.textContent = copy;
      banner.classList.remove("is-hidden");
      const style = getComputedStyle(node);
      return { whiteSpace: style.whiteSpace, height: node.getBoundingClientRect().height, lineHeight: style.lineHeight };
    }, summary);
    expect(metrics).not.toBeNull();
    expect(metrics.whiteSpace).toBe("normal");
    expect(metrics.height).toBeGreaterThan(12);
  });

  test("touch painting follows a captured pointer across cells", async ({ page }) => {
    await page.goto("/");
    await page.locator("#home-profile-tab").click();
    await page.locator("#face-clear-btn").click();
    await page.locator("#face-palette [data-ink]").first().click();
    const first = page.locator('.face-cell[data-x="0"][data-y="0"]');
    const second = page.locator('.face-cell[data-x="3"][data-y="0"]');
    const firstBox = await first.boundingBox();
    const secondBox = await second.boundingBox();
    expect(firstBox).not.toBeNull();
    expect(secondBox).not.toBeNull();
    await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(secondBox.x + secondBox.width / 2, secondBox.y + secondBox.height / 2, { steps: 2 });
    await page.mouse.up();
    const painted = await second.evaluate((el) => Boolean(el.style.backgroundColor));
    expect(painted).toBe(true);
  });

  test("static duplicate status nodes are not in the document", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#view-home .hdr-right > .online")).toHaveCount(0);
    await expect(page.locator("#view-home .chair-flag")).toHaveCount(0);
    await expect(page.locator("#tn-connection-note")).toHaveCount(0);
    await expect(page.locator("#view-game .tn-group > .online")).toHaveCount(0);
  });
});
