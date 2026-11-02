// Keep text rules in step with prompt_core.py. Tests exercise both on the same fixtures.
export const MAX_SECTIONS = 64;
export const DEFAULT_TITLES = ["Quality", "Subject", "Artists / style", "Pose & action", "Details"];
const HEADING = /^##(?:[ \t](.*))?$/;

export function defaultState() {
    return { version: 1, sections: DEFAULT_TITLES.map(title => ({ title, text: "", shared: true })),
        parked: [], separator: ", ", include_titles: false };
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
        return { title: title.trim(), text: text.replace(/\r\n?/g, "\n"), shared };
    });
}

export function readState(raw, kind) {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!value || value.version !== 1) throw new Error("Unsupported saved data format.");
    if (kind === "document") {
        if (typeof value.document !== "string") throw new Error("The document must be a string.");
        return { version: 1, document: value.document };
    }
    if (typeof value.separator !== "string" || typeof value.include_titles !== "boolean") {
        throw new Error("Invalid separator or title settings.");
    }
    return { ...value, sections: normalizeSections(value.sections),
        parked: Array.isArray(value.parked) && value.parked.length ? normalizeSections(value.parked) : [] };
}

export function parseDocument(document) {
    if (typeof document !== "string") throw new Error("The document must be a string.");
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

export function formatDocument(sections) {
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

export function joinSections(sections, separator = ", ", includeTitles = false) {
    return normalizeSections(sections).filter(section => section.text.trim()).map(({ title, text }) =>
        includeTitles && title ? title + ": " + text.trim() : text.trim()).join(decodeSeparator(separator));
}

export function resizeSections(state, count) {
    count = Math.max(1, Math.min(MAX_SECTIONS, Math.trunc(Number(count)) || 1));
    if (count < state.sections.length) {
        state.parked = state.sections.splice(count).concat(state.parked ?? []).slice(0, MAX_SECTIONS);
    }
    while (state.sections.length < count) state.sections.push(state.parked?.shift() ?? { title: "", text: "", shared: true });
    return state;
}

export function mergeSharedSections(local, incoming) {
    local = normalizeSections(local);
    incoming = normalizeSections(incoming, true);
    const result = [];
    let cursor = 0;
    for (const section of local) {
        if (!section.shared) result.push(section);
        else if (cursor < incoming.length) result.push({ ...incoming[cursor++], shared: true });
    }
    result.push(...incoming.slice(cursor).map(section => ({ ...section, shared: true })));
    return normalizeSections(result.length ? result : [{ title: "", text: "", shared: true }]);
}
