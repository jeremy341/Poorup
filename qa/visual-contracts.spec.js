import { test, expect } from "@playwright/test";

// Browser layout and accessibility contracts. The suite measures
// real layout, so it runs once on the 1920x1080 desktop project and sets its own
// viewports; every other project skips it.
test.beforeEach(({ page }, testInfo) => {
  void page;
  test.skip(testInfo.project.name !== "desktop-1920x1080", "viewport-specific contracts run on the desktop-1920x1080 project");
});

const DESKTOP = { width: 1920, height: 1080 };

async function hostLobby(page, bots = 3) {
  await page.addInitScript(() => {
    let real = null;
    let wrapped = null;
    Object.defineProperty(window, "io", {
      configurable: true,
      get() { return wrapped; },
      set(value) {
        real = value;
        wrapped = function ioWrapper(...args) {
          const socket = real(...args);
          window.__sock = socket;
          return socket;
        };
        Object.assign(wrapped, value);
      },
    });
  });
  await page.goto("/");
  await page.waitForFunction(() => window.__sock && window.__sock.connected);
  await page.fill("#home-alias", "Cora");
  await page.locator("#home-alias-form").evaluate((form) => form.requestSubmit());
  await page.click("#open-create-btn");
  await page.fill("#rc-name", "U2 contracts");
  await page.click("#rc-create-btn");
  await page.waitForSelector("#lobby-start-btn", { state: "visible" });
  for (const [key, value] of [["bots", bots], ["botBrain", "no-ai"]]) {
    await page.evaluate(([k, v]) => new Promise((resolve) => window.__sock.emit("set-setting", { key: k, value: v }, resolve)), [key, value]);
  }
}

async function startGame(page) {
  const enter = page.locator("button", { hasText: /Enter Parlor/i }).first();
  await enter.waitFor({ state: "visible" });
  await enter.click();
  await page.waitForFunction(() => { const b = document.getElementById("lobby-start-btn"); return b && !b.disabled; });
  await page.click("#lobby-start-btn");
  await page.waitForSelector("#roll-btn", { state: "visible" });
  await page.waitForFunction(() => { const b = document.getElementById("roll-btn"); return b && !b.disabled; });
}

// Hosts a lobby with the given bots and starts the game; the caller sizes the viewport first.
async function hostAndStart(page, bots = 3) {
  await hostLobby(page, bots);
  await startGame(page);
}

const inViewport = (page, selector) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.top >= -0.5 && r.left >= -0.5 && r.bottom <= innerHeight + 0.5 && r.right <= innerWidth + 0.5;
}, selector);

const documentScroll = (page) => page.evaluate(() => ({
  doc: document.documentElement.scrollHeight - innerHeight,
  body: document.body.scrollHeight - innerHeight,
}));

// Sends two chat lines and checks that the first node survives the second append.
async function chatAppendsWithoutRebuilding(page) {
  const chat = page.locator("#chat-body");
  await expect(chat).toHaveAttribute("role", "log");
  await expect(chat).toHaveAttribute("tabindex", "0");
  await expect(chat).toHaveAttribute("aria-label", /chat/i);
  // The chat is a closed dock until opened.
  await page.click("#chat-toggle");
  await page.fill("#chat-input", "first line");
  await page.keyboard.press("Enter");
  await expect(chat.locator("p.chat-line").last()).toContainText("first line");
  await chat.locator("p.chat-line").first().evaluate((el) => { el.dataset.survivor = "yes"; });
  await page.waitForTimeout(1600); // the chat send throttle drops a second message sent inside ~1s
  await page.fill("#chat-input", "second line");
  await page.keyboard.press("Enter");
  await expect(chat.locator("p.chat-line").last()).toContainText("second line");
  await expect(chat.locator('p.chat-line[data-survivor="yes"]')).toHaveCount(1);
}

// Measures a throwaway toast's dismiss button.
function toastDismissSize(page) {
  return page.evaluate(() => {
    const toast = document.createElement("div");
    toast.className = "parlor-toast";
    toast.innerHTML = '<span class="parlor-toast-title">T</span><button class="parlor-toast-close" type="button" aria-label="Dismiss">x</button>';
    document.querySelector("#toast-stack").append(toast);
    const r = toast.querySelector("button").getBoundingClientRect();
    toast.remove();
    return { w: r.width, h: r.height };
  });
}

test.describe("bounded shell for non-touch 768-1279 landscape", () => {
  for (const [width, height] of [[1024, 768], [1180, 820], [1279, 720], [800, 600]]) {
    test(`${width}x${height}: lobby Start, board and Roll are on the first screen without document scroll`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await hostLobby(page);
      expect(await documentScroll(page)).toEqual({ doc: 0, body: 0 });
      expect(await inViewport(page, "#lobby-start-btn")).toBe(true);
      await startGame(page);
      expect(await documentScroll(page)).toEqual({ doc: 0, body: 0 });
      expect(await inViewport(page, "#roll-btn")).toBe(true);
      expect(await inViewport(page, "#board-frame")).toBe(true);
    });
  }

  test("home desk keeps the document unscrolled at 1024x768 (its panel scrolls internally)", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/");
    expect(await documentScroll(page)).toEqual({ doc: 0, body: 0 });
  });
});

test.describe("board tiles", () => {
  test("tokens stacked on Start never cover the COLLECT / $200 caption", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await hostAndStart(page, 3);
    const overlaps = await page.evaluate(() => {
      const tile = document.querySelector('.tile[data-tile="0"]');
      const captions = [...tile.querySelectorAll(".tile-name, .tile-price")].map((el) => el.getBoundingClientRect());
      const pieces = [...document.querySelectorAll(".piece")].map((el) => el.getBoundingClientRect());
      const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      return pieces.filter((piece) => captions.some((caption) => hit(piece, caption))).length;
    });
    expect(overlaps).toBe(0);
  });

  test("tile captions are at least 11px at 1920x1080 and stay inside their tiles", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await hostAndStart(page, 3);
    const result = await page.evaluate(() => {
      let minName = Infinity;
      const escaped = [];
      document.querySelectorAll(".tile").forEach((tile, index) => {
        const box = tile.getBoundingClientRect();
        tile.querySelectorAll(".tile-name, .tile-price").forEach((el) => {
          if (el.matches(".tile-name")) minName = Math.min(minName, Number.parseFloat(getComputedStyle(el).fontSize));
          const r = el.getBoundingClientRect();
          if (r.left < box.left - 0.5 || r.right > box.right + 0.5 || r.top < box.top - 0.5 || r.bottom > box.bottom + 0.5) escaped.push([index, el.textContent.trim()]);
        });
      });
      return { minName, escaped };
    });
    expect(result.minName).toBeGreaterThanOrEqual(11);
    expect(result.escaped).toEqual([]);
  });
});

test.describe("accessible names and live regions", () => {
  test("dialog names, stable toggle names, appended chat rows, toast target, tile labels", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await hostAndStart(page, 1);

    // Both dialogs are named even before they are opened.
    await expect(page.getByRole("dialog", { name: /social/i, includeHidden: true }).first()).toHaveAttribute("id", "social-modal");
    await expect(page.getByRole("dialog", { name: /global rankings/i, includeHidden: true })).toHaveAttribute("id", "rankings-modal");

    // The toggle keeps its name while aria-pressed flips.
    const music = page.locator("#game-music-toggle-btn");
    const nameBefore = await music.getAttribute("aria-label");
    const pressedBefore = await music.getAttribute("aria-pressed");
    await music.click();
    await expect(music).not.toHaveAttribute("aria-pressed", pressedBefore);
    expect(await music.getAttribute("aria-label")).toBe(nameBefore);
    expect(nameBefore).toBe("Parlor music");
    await music.click();

    // Named, focusable log; new rows are appended, old nodes survive.
    await chatAppendsWithoutRebuilding(page);

    // Toast dismiss target.
    const closeSize = await toastDismissSize(page);
    expect(closeSize.w).toBeGreaterThanOrEqual(24);
    expect(closeSize.h).toBeGreaterThanOrEqual(24);

    // A priced tile names its price; owner/building/mortgage suffixes are covered by the unit contract.
    await expect(page.locator('.tile[data-tile="1"]')).toHaveAttribute("aria-label", /price \$\d+/);
  });

  test("reduced motion follows a mid-session media change", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");
    const read = () => page.evaluate(async () => (await import("/clientDom.js")).REDUCED_MOTION);
    expect(await read()).toBe(false);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(read).toBe(true);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect.poll(read).toBe(false);
  });
});
