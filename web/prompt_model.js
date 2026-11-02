// Keep text rules in step with prompt_core.py. Tests exercise both on the same fixtures.
export const MAX_SECTIONS = 64;
export const DEFAULT_TITLES = ["Quality", "Subject", "Artists / style", "Pose & action", "Details"];
const HEADING = /^##(?:[ \t](.*))?$/;
const INLINE_HEADING = /(?:^|[ \t])##[ \t]+((?:\\.|[^\\:\r\n])*):[ \t]?/g;

export function prepareSection(section = {}) {
    return { ...section, title: section.title ?? "", text: section.text ?? "", shared: section.shared ?? true,
        id: section.id ?? globalThis.crypto?.randomUUID?.() ?? `pf-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`,
        height: section.height ?? 100, color: section.color ?? null };
}

export function defaultState() {
    return { version: 1, sections: DEFAULT_TITLES.map(title => prepareSection({ title })),
        parked: [], separator: ", ", preview_height: 140 };
}

export function normalizeSections(sections, allowEmpty = false) {
    if (!Array.isArray(sections) || sections.length < (allowEmpty ? 0 : 1) || sections.length > MAX_SECTIONS) {
        throw new Error(`Expected ${allowEmpty ? 0 : 1}–${MAX_SECTIONS} fields.`);
    }
    return sections.map(section => {
        if (!section || typeof section !== "object") throw new Error("Invalid text field.");
        const { title = "", text = "", shared = true } = section;
        if (typeof title !== "string" || typeof text !== "string") throw new Error("Titles and field content must be strings.");
        if (/[\r\n]/.test(title)) throw new Error("Titles must use a single line.");
        if (typeof shared !== "boolean") throw new Error("The share switch must be a boolean.");
        const result = { title: title.trim(), text: text.replace(/\r\n?/g, "\n"), shared };
        if (section.id !== undefined) {
            if (typeof section.id !== "string" || !section.id) throw new Error("Invalid field identifier.");
            result.id = section.id;
        }
        if (section.height !== undefined) {
            if (!Number.isFinite(section.height) || section.height < 60) throw new Error("Invalid field height.");
            result.height = section.height;
        }
        if (section.color !== undefined) {
            if (section.color !== null && !/^#[\da-f]{6}$/i.test(section.color)) throw new Error("Invalid field color.");
            result.color = section.color;
        }
        return result;
    });
}

export function readState(raw, kind) {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!value || value.version !== 1) throw new Error("Unsupported saved data format.");
    if (kind === "document") {
        if (typeof value.document !== "string") throw new Error("The document must be a string.");
        const format = value.format ?? "multiline";
        if (!["multiline", "single_line"].includes(format)) throw new Error("Invalid document format.");
        return { version: 1, document: value.document, format, document_height: value.document_height ?? 440 };
    }
    if (typeof value.separator !== "string") {
        throw new Error("Invalid separator.");
    }
    const { include_titles, ...settings } = value;
    return { ...settings, sections: normalizeSections(value.sections).map(prepareSection),
        parked: Array.isArray(value.parked) ? value.parked.map(item => prepareSection(normalizeSections([item])[0])) : [],
        preview_height: value.preview_height ?? 140 };
}

const unescapeInline = text => text.replace(/\\([\\nrt:#])/g, (_, char) => ({ n: "\n", r: "\r", t: "\t" }[char] ?? char));
const escapeInline = text => text.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/##/g, "\\##");

export function parseDocument(document, format = "multiline") {
    if (typeof document !== "string") throw new Error("The document must be a string.");
    if (format === "single_line") {
        const headings = [...document.matchAll(INLINE_HEADING)];
        if (!headings.length) return document.trim() ? normalizeSections([{ title: "", text: unescapeInline(document) }]) : [];
        if (document.slice(0, headings[0].index).trim()) throw new Error("Start each group with ## Title:.");
        return normalizeSections(headings.map((heading, index) => ({
            title: unescapeInline(heading[1]).trim(),
            text: unescapeInline(document.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? document.length)),
        })), true);
    }
    const sections = [];
    let title = null, lines = [];
    const flush = () => {
        if (title !== null || lines.some(line => line.trim())) {
            sections.push({ title: title ?? "", text: lines.join("\n").replace(/^\n+|\n+$/g, "") });
        }
    };
    for (let line of document.replace(/\r\n?/g, "\n").split("\n")) {
        const heading = HEADING.exec(line);
        if (heading) {
            flush(); title = (heading[1] ?? "").trim(); lines = [];
        } else {
            if (line.startsWith("\\\\") || (line.startsWith("\\") && HEADING.test(line.slice(1)))) line = line.slice(1);
            lines.push(line);
        }
    }
    flush();
    return normalizeSections(sections, true);
}

export function formatDocument(sections, format = "multiline") {
    if (format === "single_line") {
        return normalizeSections(sections, true).map(({ title, text }) =>
            `## ${escapeInline(title).replace(/:/g, "\\:")}: ${escapeInline(text)}`).join(" ");
    }
    return normalizeSections(sections, true).map(({ title, text }) => {
        const escaped = text.replace(/^\n+|\n+$/g, "").split("\n")
            .map(line => line.startsWith("\\") || HEADING.test(line) ? "\\" + line : line).join("\n");
        return "##" + (title ? " " + title : "") + "\n" + escaped;
    }).join("\n\n");
}

export function decodeSeparator(value) {
    const escapes = { n: "\n", r: "\r", t: "\t", "\\": "\\" };
    return value.replace(/\\([nrt\\])/g, (_, escaped) => escapes[escaped]);
}

export function joinSections(sections, separator = ", ") {
    return normalizeSections(sections).filter(section => section.text.trim()).map(({ text }) => text.trim()).join(decodeSeparator(separator));
}

export function resizeSections(state, count) {
    count = Math.max(1, Math.min(MAX_SECTIONS, Math.trunc(Number(count)) || 1));
    if (count < state.sections.length) {
        state.parked = state.sections.splice(count).concat(state.parked ?? []);
    }
    while (state.sections.length < count) state.sections.push(state.parked?.shift() ?? prepareSection());
    return state;
}

export function mergeSharedSections(local, incoming) {
    local = normalizeSections(local);
    incoming = normalizeSections(incoming, true);
    const result = [];
    let cursor = 0;
    for (const section of local) {
        if (!section.shared) result.push(section);
        else if (cursor < incoming.length) {
            const replacement = incoming[cursor++];
            result.push({ ...section, title: replacement.title, text: replacement.text, shared: true });
        }
    }
    result.push(...incoming.slice(cursor).map(section => ({ ...section, shared: true })));
    return normalizeSections(result.length ? result : [{ title: "", text: "", shared: true }]);
}

export function moveSection(state, from, to) {
    if (from === to || from < 0 || to < 0 || from >= state.sections.length || to >= state.sections.length) return;
    state.sections.splice(to, 0, state.sections.splice(from, 1)[0]);
}
