import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defaultState, parseDocument, formatDocument, joinSections, decodeSeparator,
    mergeSharedSections, resizeSections } from "../web/prompt_model.js";

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
    assert.equal(joinSections([{ title: "A", text: "a", shared: false }, { title: "B", text: "b" }], "\\n", true), "A: a\nB: b");
});
test("invalid large documents and private+shared overflow fail", () => {
    assert.throws(() => parseDocument(Array(65).fill("## A").join("\n")));
    assert.throws(() => mergeSharedSections([{ text: "private", shared: false }], Array(64).fill({ text: "new" })));
});
