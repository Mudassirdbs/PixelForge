import { test, expect, type Page } from "@playwright/test";
import { makePng } from "./fixtures";

/**
 * Give React time to attach the onChange handler to the hidden <input type=file>
 * before Playwright fires setInputFiles. Without this, the file lands on the
 * DOM element but the React handler misses the event and no queue item appears.
 */
async function readyDropzone(page: Page) {
  await page.waitForSelector('input[type="file"]');
  // React attaches delegated event handlers on mount. Without this settle
  // window, tab clicks and setInputFiles fire before React is listening.
  await page.waitForTimeout(1500);
}

async function uploadFile(page: Page, name: string, buffer: Buffer, mimeType = "image/png") {
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType, buffer });
}


test.describe("PixelForge UI smoke", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await readyDropzone(page);
  });


  test("renders the converter shell with all tabs and default formats", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /cloud image toolkit/i })).toBeVisible();
    for (const t of ["Convert", "Compress", "Resize", "Remove BG"]) {
      await expect(page.getByRole("tab", { name: new RegExp(t, "i") })).toBeVisible();
    }
    await expect(page.getByRole("combobox", { name: /from format/i })).toContainText(/ANY/);
    await expect(page.getByRole("combobox", { name: /to format/i })).toContainText(/WEBP/);
    await expect(page.getByRole("button", { name: /upload images/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /view on github/i })).toBeVisible();
  });

  test("switching tabs swaps the options panel", async ({ page }) => {
    await page.getByRole("tab", { name: /compress/i }).click();
    await expect(page.locator("#target-kb")).toBeVisible();

    await page.getByRole("tab", { name: /^resize$/i }).click();
    await expect(page.getByRole("combobox", { name: /mode format/i })).toBeVisible();

    await page.getByRole("tab", { name: /convert/i }).click();
    await expect(page.getByRole("combobox", { name: /to format/i })).toBeVisible();
  });



  test("format picker opens and offers WEBP, PNG, JPG", async ({ page }) => {
    await page.getByRole("combobox", { name: /to format/i }).click();
    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible();
    for (const f of ["WEBP", "PNG", "JPG"]) {
      await expect(listbox).toContainText(f);
    }
  });

  test("has no console errors on load", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /cloud image toolkit/i })).toBeVisible();
    await page.waitForTimeout(1000);
    expect(errors, `errors: ${errors.join(" | ")}`).toEqual([]);
  });
});

test.describe("PixelForge conversion flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await readyDropzone(page);
  });

  test("converts PNG → WEBP, shows preview, and downloads real WEBP bytes", async ({
    page,
    browserName,
  }) => {
    await uploadFile(page, "smoke.png", makePng(80, 60));

    const downloadBtn = page.getByRole("button", { name: /^download smoke\.webp$/i });
    await expect(downloadBtn).toBeVisible({ timeout: 30_000 });

    // Preview modal renders the converted image.
    await page.getByRole("button", { name: /open preview of smoke\.webp/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("img").first()).toBeVisible();
    await page.keyboard.press("Escape");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      downloadBtn.click(),
    ]);
    const path = await download.path();
    expect(path, `download path missing on ${browserName}`).toBeTruthy();

    const fs = await import("node:fs/promises");
    const head = await fs.readFile(path!);
    expect(head.length).toBeGreaterThan(20);
    expect(head.slice(0, 4).toString("ascii")).toBe("RIFF");
    expect(head.slice(8, 12).toString("ascii")).toBe("WEBP");
  });

  test("rejects unsupported files with an accessible status message", async ({ page }) => {
    await uploadFile(page, "junk.txt", Buffer.from("not an image"), "text/plain");
    const status = page.locator('[role="status"][aria-live="polite"]');
    await expect(status).toContainText(/skip|unsupported/i, { timeout: 10_000 });
    await expect(page.getByRole("button", { name: /^download/i })).toHaveCount(0);
  });

  test("resize mode auto-fills width/height from the uploaded image", async ({ page }) => {
    await page.getByRole("tab", { name: /^resize$/i }).click();
    // Wait for the resize toolbar Mode combobox to render.
    await expect(page.getByRole("combobox", { name: /mode format/i })).toBeVisible();


    // Open the Mode combobox (first combobox in the resize toolbar).
    await page.getByRole("combobox", { name: /mode format/i }).click();
    await page.getByRole("option").filter({ hasText: /^EXACT/i }).click();

    await uploadFile(page, "sized.png", makePng(320, 240));

    await expect(page.getByLabel("Width")).toHaveValue("320", { timeout: 15_000 });
    await expect(page.getByLabel("Height")).toHaveValue("240");
  });

});
