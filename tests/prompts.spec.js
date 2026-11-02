import { test, expect } from "@playwright/test";
import path from "node:path";
import { mkdirSync } from "node:fs";

const body = (page, index) => page.getByRole("textbox", { name: `text_${index + 1}`, exact: true });
const document = page => page.getByRole("textbox", { name: "prompt_document", exact: true });
const preview = page => page.getByRole("textbox", { name: "final_prompt", exact: true });
const shareName = index => `${String(index + 1).padStart(2, "0")} · share with Prompt Clay`;
const titleName = index => `${String(index + 1).padStart(2, "0")} · title`;
const set = (page, name, value) => page.evaluate(({ name, value }) => harness.set(name, value), { name, value });
const status = page => page.evaluate(() => harness.widget("status").value);
const create = page => page.evaluate(() => harness.click("Create Prompt Clay"));

test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => window.harnessReady);
});

test("native widgets: preview, separators, titles and count restoration", async ({ page }) => {
    await body(page, 0).fill("masterpiece"); await body(page, 1).fill("forest");
    await expect(preview(page)).toHaveValue("masterpiece, forest");
    await set(page, shareName(0), false);
    await expect(preview(page)).toHaveValue("masterpiece, forest");
    await set(page, "separator", "\\n");
    await expect(preview(page)).toHaveValue("masterpiece\nforest");
    await set(page, titleName(0), "Quality");
    await set(page, "include_titles_in_prompt", true);
    await expect(preview(page)).toHaveValue("Quality: masterpiece\nSubject: forest");
    await body(page, 4).fill("restored text");
    await set(page, "input_count", 2);
    await expect(page.locator('textarea[aria-label^="text_"]')).toHaveCount(2);
    await set(page, "input_count", 5);
    await expect(body(page, 4)).toHaveValue("restored text");
});

test("widget-callback text edits survive renaming, switches and save/reload", async ({ page }) => {
    // Vue editors and other ComfyUI integrations update the widget value and
    // callback directly; they do not dispatch input on the legacy textarea.
    await set(page, "text_1", "keep this prompt");
    await set(page, titleName(0), "Renamed");
    await expect(body(page, 0)).toHaveValue("keep this prompt");
    await expect(preview(page)).toHaveValue("keep this prompt");
    await set(page, shareName(0), false);
    await expect(body(page, 0)).toHaveValue("keep this prompt");
    await page.evaluate(() => harness.restore(harness.save()));
    await expect(body(page, 0)).toHaveValue("keep this prompt");
});

test("Clay widget callbacks update shared fields without legacy DOM input", async ({ page }) => {
    await create(page);
    await page.evaluate(() => harness.set("prompt_document", "## Renamed\nkeep this prompt", harness.source()));
    await expect(body(page, 0)).toHaveValue("keep this prompt");
    await set(page, titleName(0), "Another title");
    await expect(document(page)).toHaveValue("## Another title\nkeep this prompt");
});

test("switch excludes only from Clay; document edits keep excluded text", async ({ page }) => {
    await body(page, 0).fill("fixed quality tags"); await body(page, 1).fill("old subject");
    await set(page, shareName(0), false); await create(page);
    await expect(document(page)).not.toHaveValue(/fixed quality tags/);
    await document(page).fill("## Subject\nnew subject\n\n## Lighting\nsoft light");
    await expect(body(page, 0)).toHaveValue("fixed quality tags");
    await expect(preview(page)).toHaveValue("fixed quality tags, new subject, soft light");
    await body(page, 1).fill("manual subject");
    await expect(document(page)).toHaveValue(/manual subject/);
    await set(page, shareName(1), false);
    await expect(document(page)).not.toHaveValue(/manual subject/);
    await expect(preview(page)).toHaveValue("fixed quality tags, manual subject, soft light");
    await document(page).fill("## Lighting\nmoonlight");
    await expect(preview(page)).toHaveValue("fixed quality tags, manual subject, moonlight");
    await set(page, shareName(1), true);
    await expect(document(page)).toHaveValue(/manual subject/);
});

test("all switches off clears Clay and keeps final prompt", async ({ page }) => {
    await set(page, "input_count", 2);
    await body(page, 0).fill("always"); await body(page, 1).fill("visible");
    await create(page);
    await set(page, shareName(0), false); await set(page, shareName(1), false);
    await expect(document(page)).toHaveValue("");
    await expect(preview(page)).toHaveValue("always, visible");
});

test("save/reload preserves editors, switches, separator and parked fields", async ({ page }) => {
    await body(page, 0).fill("excluded"); await set(page, shareName(0), false);
    await body(page, 1).fill("shared"); await body(page, 4).fill("parked");
    await set(page, "input_count", 2); await set(page, "separator", " | "); await create(page);
    const serialized = await page.evaluate(() => harness.save());
    expect(serialized.nodes.every(node => node.widgets_values.length === 1)).toBe(true);
    await page.evaluate(data => harness.restore(data), serialized);
    await expect(preview(page)).toHaveValue("excluded | shared");
    await expect(document(page)).not.toHaveValue(/excluded/);
    await document(page).fill("## Changed\nnew shared");
    await expect(preview(page)).toHaveValue("excluded | new shared");
    await set(page, "input_count", 5);
    await expect(body(page, 4)).toHaveValue("parked");
});

test("invalid document clears stale preview, stays invalid on separator edit and recovers", async ({ page }) => {
    await body(page, 0).fill("quality"); await create(page);
    await document(page).fill(Array(65).fill("## A\nvalue").join("\n"));
    expect(await status(page)).toMatch(/^Error:/);
    await expect(preview(page)).toHaveValue("");
    await set(page, "separator", " | ");
    expect(await status(page)).toMatch(/^Error:/);
    await expect(preview(page)).toHaveValue("");
    await document(page).fill("## A\nrecovered");
    await expect(preview(page)).toHaveValue("recovered");
    await page.evaluate(() => harness.separator.disconnectInput(0));
    await document(page).fill("## A\nnot connected");
    await expect(preview(page)).toHaveValue("recovered");
});

test("local edits cannot overwrite an invalid Clay document", async ({ page }) => {
    await body(page, 0).fill("original prompt"); await create(page);
    const invalid = Array(65).fill("## A\nkeep my document").join("\n");
    await document(page).fill(invalid);
    await set(page, titleName(0), "Renamed locally");
    await expect(document(page)).toHaveValue(invalid);
    await expect(body(page, 0)).toHaveValue("original prompt");
    await expect(preview(page)).toHaveValue("");
});

test("callbacks from removed text widgets cannot replace current fields", async ({ page }) => {
    await body(page, 0).fill("current prompt");
    await page.evaluate(() => { window.removedText = harness.widget("text_1"); });
    await set(page, "input_count", 2);
    await page.evaluate(() => { removedText.callback?.("stale text"); });
    await expect(body(page, 0)).toHaveValue("current prompt");
    await expect(preview(page)).toHaveValue("current prompt");
});

test("late execution cannot overwrite live edits", async ({ page }) => {
    await body(page, 0).fill("latest text");
    await page.evaluate(() => harness.separator.onExecuted({ sections: [{ title: "Old", text: "stale" }] }));
    await expect(preview(page)).toHaveValue("latest text");
    await create(page); await document(page).fill("## A\nnewer text");
    await page.evaluate(() => harness.separator.onExecuted({ sections: [{ title: "Old", text: "stale" }] }));
    await expect(preview(page)).toHaveValue("newer text");
});

test("canvas toggle uses native ComfyUI controls", async ({ page }) => {
    const point = await page.evaluate(name => harness.point(name), shareName(0));
    await page.mouse.click(point.x, point.y);
    expect(await page.evaluate(() => harness.state().sections[0].shared)).toBe(false);
});

test("native canvas screenshot for README", async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await set(page, "input_count", 3);
    await set(page, titleName(0), "Quality"); await body(page, 0).fill("masterpiece, best quality, detailed");
    await set(page, titleName(1), "Subject"); await body(page, 1).fill("a quiet forest path, morning mist");
    await set(page, titleName(2), "Lighting & mood"); await body(page, 2).fill("soft golden light, peaceful atmosphere");
    await set(page, shareName(0), false); await create(page);
    await page.evaluate(() => {
        const clip = LiteGraph.createNode("CLIPTextEncode");
        clip.pos = [1040, 60]; harness.app.graph.add(clip);
        harness.separator.connect(0, clip, 1);
        harness.app.canvas.draw(true, true);
    });
    await expect(preview(page)).toHaveValue("masterpiece, best quality, detailed, a quiet forest path, morning mist, soft golden light, peaceful atmosphere");
    await page.waitForFunction(() => [...document.querySelectorAll("textarea")].every(input => input.style.left));
    expect(errors).toEqual([]);
    mkdirSync("docs", { recursive: true });
    await page.screenshot({ path: path.resolve("docs", "preview.png"), clip: { x: 0, y: 0, width: 1400, height: 940 } });
});
