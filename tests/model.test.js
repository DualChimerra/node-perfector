import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defaultState, parseDocument, formatDocument, joinSections, decodeSeparator,
    mergeSharedSections, resizeSections, moveSection, readState } from "../web/prompt_model.js";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures.json", import.meta.url), "utf8"));
for (const fixture of fixtures.documents) {
    test("document: " + fixture.name, () => {
        assert.deepEqual(parseDocument(fixture.document), fixture.expected);
        assert.deepEqual(parseDocument(formatDocument(fixture.expected)), fixture.expected);
    });
}
for (const fixture of fixtures.merges) {
    test("sync: " + fixture.name, () => {
        assert.equal(joinSections(mergeSharedSections(fixture.local, fixture.incoming)), fixture.output);
    });
}
for (const fixture of fixtures.inline_documents) {
    test("inline: " + fixture.name, () => {
        assert.deepEqual(parseDocument(fixture.document, "single_line"), fixture.expected);
        assert.deepEqual(parseDocument(formatDocument(fixture.expected, "single_line"), "single_line"), fixture.expected);
    });
}
test("edits in Clay keep field colors, identity and height", () => {
    const local = [{ id: "a", title: "Old", text: "old", shared: true, color: "#88aaff", height: 250 }];
    const merged = mergeSharedSections(local, [{ title: "New", text: "new" }]);
    assert.deepEqual(merged, [{ ...local[0], title: "New", text: "new" }]);
});
test("reordering and repeated shrink/grow retain complete blocks", () => {
    const state = defaultState();
    state.sections[2].text = "retained";
    state.sections[2].height = 270;
    state.sections[2].color = "#aa55ff";
    const original = structuredClone(state.sections[2]);
    moveSection(state, 2, 4);
    resizeSections(state, 1); resizeSections(state, 3); resizeSections(state, 2); resizeSections(state, 5);
    assert.deepEqual(state.sections[4], original);
    const restored = readState(JSON.stringify(state), "builder");
    assert.deepEqual(restored.sections[4], original);
});
test("count changes restore removed values and switches", () => {
    const state = defaultState();
    state.sections[4] = { title: "Fixed", text: "keep me", shared: false };
    const original = structuredClone(state.sections);
    resizeSections(state, 2);
    resizeSections(state, 1);
    resizeSections(state, 5);
    assert.deepEqual(state.sections, original);
});
test("separator escapes, Unicode and headers", () => {
    assert.equal(decodeSeparator("\\n"), "\n");
    assert.equal(decodeSeparator("\\\\n"), "\\n");
    assert.equal(decodeSeparator(" → "), " → ");
    assert.equal(joinSections([{ title: "A", text: "a", shared: false }, { title: "B", text: "b" }], "\\n"), "a\nb");
});
test("invalid large documents and private+shared overflow fail", () => {
    assert.throws(() => parseDocument(Array(65).fill("## A").join("\n")));
    assert.throws(() => mergeSharedSections([{ text: "private", shared: false }], Array(64).fill({ text: "new" })));
});
