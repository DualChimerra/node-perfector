import { test, expect } from "@playwright/test";

// Optional integration suite against an isolated, running ComfyUI instance.
// The server must enable Node Perfector and use a temporary user directory.
test.skip(!process.env.COMFYUI_TEST_URL, "Set COMFYUI_TEST_URL to an isolated ComfyUI test server.");

test.beforeEach(async ({ page }) => {
    await page.goto(process.env.COMFYUI_TEST_URL);
    await page.getByRole("status", { name: "Loading ComfyUI", exact: true }).waitFor({ state: "hidden" });
    await page.waitForSelector("#graph-canvas");
    await page.waitForFunction(() => window.comfyAPI?.app?.app?.vueAppReady &&
        globalThis.LiteGraph?.registered_node_types?.PerfectorPromptSeparator);
    await page.evaluate(async () => {
        const app = window.comfyAPI.app.app;
        await app.loadGraphData({ nodes: [], links: [], groups: [], config: {}, extra: {}, version: 0.4 });
        const separator = LiteGraph.createNode("PerfectorPromptSeparator");
        app.graph.add(separator);
        separator.pos = [530, 80];
        app.canvas.ds.scale = 0.8;
        app.canvas.ds.offset = [0, 0];
        window.perfectorTest = {
            app, separator,
            state(node = this.separator) { return JSON.parse(node.widgets.find(w => w.name === "state").value); },
            widget(name, node = this.separator) { return node.widgets.find(w => w.name === name); },
            set(name, value, node = this.separator) {
                const widget = this.widget(name, node);
                if (!widget) {
                    const field = /^(\d+) · (title|share with Prompt Clay)$/.exec(name);
                    const controls = this.widget("header_" + Number(field[1]), node).controls;
                    const input = field[2] === "title" ? controls.title : controls.shared;
                    if (field[2] === "title") input.value = value;
                    else input.checked = value;
                    input.dispatchEvent(new Event(field[2] === "title" ? "input" : "change"));
                    return;
                }
                widget.value = value;
                widget.callback?.(value);
            },
            clay() { return app.graph._nodes.find(node => node.comfyClass === "PerfectorPromptClay"); },
        };
    });
});

test("real ComfyUI: renaming preserves native widget edits and saved workflow", async ({ page }) => {
    const result = await page.evaluate(async () => {
        const qa = window.perfectorTest;
        qa.set("text_1", "keep this prompt");
        qa.set("01 · title", "Renamed");
        qa.set("02 · title", "Renamed empty field");
        qa.separator.title = "Renamed node";
        const before = qa.state();
        const exported = await qa.app.graphToPrompt();
        await qa.app.loadGraphData(exported.workflow);
        const restored = qa.app.graph._nodes.find(node => node.comfyClass === "PerfectorPromptSeparator");
        return { before, after: qa.state(restored), inputs: exported.output[String(qa.separator.id)].inputs };
    });
    expect(result.before.sections[0]).toMatchObject({ title: "Renamed", text: "keep this prompt", shared: true });
    expect(result.after.sections[0]).toEqual(result.before.sections[0]);
    expect(Object.keys(result.inputs)).toEqual(["state"]);
});

test("real ComfyUI: both callback paths synchronize and preserve excluded fields", async ({ page }) => {
    const result = await page.evaluate(() => {
        const qa = window.perfectorTest;
        qa.set("text_1", "fixed quality");
        qa.set("01 · share with Prompt Clay", false);
        qa.widget("Create Prompt Clay").callback();
        const clay = qa.clay();
        qa.set("prompt_document", "## Subject\nforest", clay);
        qa.set("02 · title", "Renamed subject");
        return { state: qa.state(), document: qa.state(clay).document, preview: qa.widget("final_prompt").value };
    });
    expect(result.state.sections[0].text).toBe("fixed quality");
    expect(result.document).toBe("## Renamed subject\nforest");
    expect(result.preview).toBe("fixed quality, forest");
});

test("real ComfyUI: generated API prompt produces the same text as the preview", async ({ page }) => {
    const { prompt, expected } = await page.evaluate(async () => {
        const qa = window.perfectorTest;
        qa.set("text_1", "fixed quality");
        qa.set("01 · share with Prompt Clay", false);
        qa.widget("Create Prompt Clay").callback();
        qa.set("prompt_document", "## Subject\nforest", qa.clay());
        const preview = LiteGraph.createNode("PreviewAny");
        qa.app.graph.add(preview);
        qa.separator.connect(0, preview, 0);
        const exported = await qa.app.graphToPrompt();
        return { prompt: exported.output, expected: qa.widget("final_prompt").value };
    });
    const response = await page.request.post(process.env.COMFYUI_TEST_URL + "/prompt", { data: { prompt } });
    expect(response.ok(), await response.text()).toBe(true);
    const { prompt_id: id } = await response.json();
    let history;
    await expect.poll(async () => {
        history = await (await page.request.get(process.env.COMFYUI_TEST_URL + "/history/" + id)).json();
        return history[id]?.status?.completed;
    }).toBe(true);
    const texts = Object.values(history[id].outputs).flatMap(output => output.text ?? []);
    expect(texts).toContain(expected);
});

test("real ComfyUI: compact headers, colors, drag heights and inline mode survive reload", async ({ page }) => {
    await page.evaluate(() => {
        const qa = window.perfectorTest;
        qa.set("input_count", 3);
        qa.set("text_1", "fixed quality"); qa.set("text_2", "forest"); qa.set("text_3", "soft light");
        qa.set("01 · share with Prompt Clay", false);
    });
    const input = page.getByRole("textbox", { name: "text_1", exact: true });
    const rect = await input.boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height - 3);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height + 77, { steps: 8 });
    await page.mouse.up();
    const preview = page.getByRole("textbox", { name: "final_prompt", exact: true });
    const outputRect = await preview.boundingBox();
    await page.mouse.move(outputRect.x + outputRect.width / 2, outputRect.y + outputRect.height - 3);
    await page.mouse.down();
    await page.mouse.move(outputRect.x + outputRect.width / 2, outputRect.y + outputRect.height + 47, { steps: 8 });
    await page.mouse.up();
    await page.getByLabel("Color for input 1", { exact: true }).evaluate(input => {
        input.value = "#8b71b5"; input.dispatchEvent(new Event("input"));
    });
    const original = await page.evaluate(() => perfectorTest.state().sections[0]);
    expect(original.height).toBeGreaterThan(190);
    await page.getByRole("button", { name: "Move input 1", exact: true }).dragTo(page.getByRole("button", { name: "Move input 3", exact: true }));
    await expect(page.getByRole("textbox", { name: "final_prompt", exact: true })).toHaveValue("forest, soft light, fixed quality");
    const result = await page.evaluate(async () => {
        const qa = window.perfectorTest;
        qa.widget("Create Prompt Clay").callback();
        qa.set("format", "Single line", qa.clay());
        const document = qa.state(qa.clay()).document;
        qa.set("input_count", 1); qa.set("input_count", 3);
        const saved = (await qa.app.graphToPrompt()).workflow;
        await qa.app.loadGraphData(saved);
        const node = qa.app.graph._nodes.find(node => node.comfyClass === "PerfectorPromptSeparator");
        return { document, fields: qa.state(node).sections, previewHeight: qa.state(node).preview_height };
    });
    expect(result.document).toBe("## Subject: forest ## Artists / style: soft light");
    expect(result.fields[2]).toEqual(original);
    expect(result.previewHeight).toBeGreaterThan(190);
    await page.screenshot({ path: "test-results/actual-layout.png" });
});
