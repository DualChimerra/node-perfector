import { app } from "../../scripts/app.js";
import { ComfyWidgets } from "../../scripts/widgets.js";
import { defaultState, readState, parseDocument, formatDocument, joinSections,
    resizeSections, mergeSharedSections, prepareSection, moveSection, MAX_SECTIONS } from "./prompt_model.js";

const SEPARATOR = "PerfectorPromptSeparator";
const CLAY = "PerfectorPromptClay";
const controllers = new Set();
const byNode = new WeakMap();

function findSource(node) {
    let linkId = node.inputs?.find(slot => slot.name === "sections")?.link;
    const linked = linkId != null;
    const visited = new Set();
    while (linkId != null && !visited.has(linkId)) {
        visited.add(linkId);
        const link = node.graph?.links?.get?.(linkId) ?? node.graph?.links?.[linkId];
        const origin = node.graph?.getNodeById(link?.origin_id);
        const controller = byNode.get(origin);
        if (controller?.kind === "clay") return { linked, controller };
        if (origin?.type !== "Reroute") break;
        linkId = origin.inputs?.[0]?.link;
    }
    return { linked, controller: null };
}

function broadcast(source, except = null) {
    for (const target of controllers) {
        if (target.kind === "separator" && target !== except && findSource(target.node).controller === source) {
            target.syncSource();
        }
    }
}

function transient(widget) {
    // Persist only the original backend state widget. Native UI widgets are views of it.
    widget.serialize = false;
    widget.options ??= {};
    widget.options.serialize = false;
    return widget;
}

function textarea(widget) {
    const element = widget.element ?? widget.inputEl;
    return element?.tagName === "TEXTAREA" ? element : element?.querySelector?.("textarea");
}

class PromptController {
    constructor(node, kind) {
        this.node = node;
        this.kind = kind;
        this.storage = node.widgets.find(widget => widget.name === "state");
        this.state = kind === "separator" ? defaultState()
            : { version: 1, document: formatDocument(defaultState().sections), format: "multiline", document_height: 440 };
        this.fields = [];
        this.originalBoxColor = node.boxcolor;
        this.storage.hidden = true;
        this.storage.type = "hidden";
        this.storage.computeSize = () => [0, -4];
        this.storage.computeLayoutSize = () => ({ minWidth: 0, minHeight: 0, maxHeight: 0 });
        this.storage.serializeValue = () => this.storage.value;
        const previousStorageCallback = this.storage.callback;
        this.storage.callback = (...args) => {
            previousStorageCallback?.apply(this.storage, args);
            if (!this.writing) this.load();
        };

        if (kind === "separator") this.createSeparator();
        else this.createClay();

        const previousConfigure = node.onConfigure;
        node.onConfigure = (...args) => {
            const result = previousConfigure?.apply(node, args);
            this.load();
            return result;
        };
        const previousConnections = node.onConnectionsChange;
        node.onConnectionsChange = (...args) => {
            const result = previousConnections?.apply(node, args);
            queueMicrotask(() => {
                if (this.removed || app.configuringGraph) return;
                if (this.kind === "separator") this.syncSource();
                else broadcast(this);
            });
            return result;
        };
        const previousExecuted = node.onExecuted;
        node.onExecuted = message => {
            previousExecuted?.call(node, message);
            const source = this.kind === "separator" ? findSource(node) : null;
            // Known editors already show newer live values. Never replace them with
            // an execution result queued before the user finished editing.
            if (source?.linked && !source.controller && Array.isArray(message?.sections)) {
                this.state.sections = message.sections.map(section => ({ ...section }));
                this.save(); this.render();
            }
        };
        const previousRemoved = node.onRemoved;
        node.onRemoved = (...args) => {
            this.removed = true;
            controllers.delete(this);
            return previousRemoved?.apply(node, args);
        };
        this.load();
        this.fit(false);
    }

    add(type, name, value, callback, options = {}) {
        return transient(this.node.addWidget(type, name, value, callback, options));
    }

    multiline(name, value, callback, height, readOnly = false) {
        const widget = transient(ComfyWidgets.STRING(this.node, name,
            ["STRING", { default: value, multiline: true, dynamicPrompts: false }], app).widget);
        const getHeight = typeof height === "function" ? height : () => height;
        widget.options.getMinHeight = getHeight;
        widget.options.getMaxHeight = getHeight;
        widget.options.getHeight = getHeight;
        widget.options.readOnly = readOnly;
        widget.computeSize = width => [width, getHeight()];
        const input = textarea(widget);
        const events = new AbortController();
        let disposed = false;
        const accept = value => {
            if (this.rendering || this.removed || disposed || !callback) return;
            callback(typeof value === "string" ? value : widget.value);
        };
        const previousCallback = widget.callback;
        widget.callback = function (value, ...args) {
            previousCallback?.call(this, value, ...args);
            accept(value);
        };
        const previousRemove = widget.onRemove;
        widget.onRemove = function (...args) {
            if (disposed) return;
            disposed = true;
            events.abort();
            return previousRemove?.apply(this, args);
        };
        if (input) {
            input.readOnly = readOnly;
            input.spellcheck = false;
            input.setAttribute("aria-label", name);
            if (callback) input.addEventListener("input", () => accept(input.value), { signal: events.signal });
        }
        return widget;
    }

    resizable(widget, getHeight, setHeight) {
        const input = textarea(widget);
        if (!input) return;
        input.style.resize = "vertical";
        const events = new AbortController();
        let drag = null;
        const finish = () => {
            if (!drag) return;
            drag = null;
            this.save();
            this.node.graph?.afterChange?.(this.node);
        };
        input.addEventListener("pointerdown", event => {
            const rect = input.getBoundingClientRect();
            if (event.button !== 0 || event.clientY < rect.bottom - 9) return;
            event.preventDefault(); event.stopImmediatePropagation();
            this.node.graph?.beforeChange?.(this.node);
            drag = { y: event.clientY, height: getHeight(), scale: app.canvas?.ds?.scale || 1 };
            input.setPointerCapture(event.pointerId);
        }, { capture: true, signal: events.signal });
        input.addEventListener("pointermove", event => {
            if (!drag) {
                input.style.cursor = event.clientY >= input.getBoundingClientRect().bottom - 9 ? "ns-resize" : "text";
                return;
            }
            event.preventDefault(); event.stopPropagation();
            const height = Math.max(60, Math.round(drag.height + (event.clientY - drag.y) / drag.scale));
            const difference = height - getHeight();
            setHeight(height);
            this.node.setSize([this.node.size[0], this.node.size[1] + difference]);
            this.save();
        }, { signal: events.signal });
        input.addEventListener("pointerup", finish, { signal: events.signal });
        input.addEventListener("pointercancel", finish, { signal: events.signal });
        input.addEventListener("lostpointercapture", finish, { signal: events.signal });
        const remove = widget.onRemove;
        widget.onRemove = function (...args) { finish(); events.abort(); return remove?.apply(this, args); };
    }

    sectionHeader(index) {
        const section = () => this.state.sections[index];
        const root = document.createElement("div");
        root.className = "perfector-section-header";
        root.dataset.sectionId = section().id;
        const events = new AbortController();
        const listen = (el, type, callback) => el.addEventListener(type, callback, { signal: events.signal });
        const number = document.createElement("label");
        number.className = "pf-number";
        number.append(document.createTextNode(String(index + 1).padStart(2, "0")));
        number.title = "Choose block color · Right-click to reset";
        const color = document.createElement("input");
        color.type = "color";
        color.setAttribute("aria-label", `Color for input ${index + 1}`);
        number.append(color);
        const title = document.createElement("input");
        title.type = "text";
        title.className = "pf-title";
        title.placeholder = "Title";
        title.setAttribute("aria-label", `title_${index + 1}`);
        const shared = document.createElement("input");
        shared.type = "checkbox";
        shared.className = "pf-share";
        shared.setAttribute("role", "switch");
        shared.setAttribute("aria-label", `Share input ${index + 1} with Prompt Clay`);
        shared.title = "Include this group in Prompt Clay. The final prompt always keeps its text.";
        const handle = document.createElement("button");
        handle.type = "button";
        handle.className = "pf-drag";
        handle.draggable = true;
        handle.setAttribute("aria-label", `Move input ${index + 1}`);
        handle.title = "Drag to reorder · Alt+Arrow Up/Down";
        const icon = document.createElement("img");
        icon.src = new URL("./icons/drag-vertical.svg", import.meta.url).href;
        icon.alt = ""; icon.draggable = false;
        handle.append(icon);
        root.append(number, title, shared, handle);
        listen(title, "input", () => this.change(() => { section().title = title.value; }, true));
        listen(shared, "change", () => this.change(() => { section().shared = shared.checked; }, true));
        listen(color, "input", () => this.change(() => { section().color = color.value; }));
        listen(number, "contextmenu", event => {
            event.preventDefault(); event.stopPropagation();
            this.change(() => { section().color = null; });
        });
        for (const name of ["pointerdown", "mousedown", "keydown", "dblclick"]) listen(root, name, event => event.stopPropagation());
        listen(handle, "dragstart", event => {
            this.draggingSection = section().id;
            event.dataTransfer.setData("text/plain", section().id);
            event.dataTransfer.effectAllowed = "move";
            event.stopPropagation();
        });
        listen(root, "dragover", event => {
            if (!this.draggingSection) return;
            event.preventDefault(); event.stopPropagation(); root.classList.add("pf-drop");
            event.dataTransfer.dropEffect = "move";
        });
        listen(root, "dragleave", () => root.classList.remove("pf-drop"));
        listen(root, "drop", event => {
            if (!this.draggingSection) return;
            event.preventDefault(); event.stopPropagation();
            const from = this.state.sections.findIndex(item => item.id === this.draggingSection);
            this.draggingSection = null;
            this.change(() => moveSection(this.state, from, index), true);
        });
        listen(handle, "dragend", () => {
            this.draggingSection = null;
            for (const field of this.fields) field.header.element.classList.remove("pf-drop");
        });
        listen(handle, "keydown", event => {
            if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
            event.preventDefault();
            const to = Math.max(0, Math.min(this.fields.length - 1, index + (event.key === "ArrowUp" ? -1 : 1)));
            this.change(() => moveSection(this.state, index, to), true);
            this.fields[to].header.element.querySelector("button").focus();
        });
        const widget = transient(this.node.addDOMWidget(`header_${index + 1}`, "PERFECTOR_SECTION_HEADER", root, {
            serialize: false, hideOnZoom: true, getValue: () => "", setValue: () => {},
            getMinHeight: () => 50, getMaxHeight: () => 50, getHeight: () => 50,
        }));
        widget.computeSize = width => [width, 50];
        const remove = widget.onRemove;
        widget.onRemove = function (...args) { events.abort(); return remove?.apply(this, args); };
        widget.controls = { title, shared, color, number };
        return widget;
    }

    previewDivider() {
        // A small canvas widget, using LiteGraph's theme; no HTML or stylesheet.
        return transient(this.node.addCustomWidget({
            name: "final_prompt_heading", type: "PERFECTOR_PREVIEW_HEADING", value: "", options: {},
            computeSize: width => [width, 34],
            draw(ctx, node, width, y) {
                ctx.save();
                ctx.strokeStyle = globalThis.LiteGraph?.WIDGET_OUTLINE_COLOR ?? "#666";
                ctx.beginPath(); ctx.moveTo(10, y + 7); ctx.lineTo(width - 10, y + 7); ctx.stroke();
                ctx.fillStyle = globalThis.LiteGraph?.WIDGET_TEXT_COLOR ?? "#ddd";
                ctx.font = "12px Arial";
                ctx.textAlign = "left";
                ctx.fillText("Final prompt · preview (read only)", 12, y + 27);
                ctx.restore();
            },
        }));
    }

    createSeparator() {
        this.count = this.add("number", "input_count", this.state.sections.length,
            value => this.change(() => { resizeSections(this.state, value); this.fitAfterRender = true; }, true),
            { min: 1, max: MAX_SECTIONS, step: 10, precision: 0 });
        this.separator = this.add("text", "separator", ", ",
            value => this.change(() => { this.state.separator = value; }));
        this.previewDivider();
        this.preview = this.multiline("final_prompt", "", null, () => this.state.preview_height, true);
        this.resizable(this.preview, () => this.state.preview_height, height => { this.state.preview_height = height; });
        this.createButton = this.add("button", "Create Prompt Clay", null, () => this.createClayNode());
    }

    createClay() {
        this.format = this.add("combo", "format", "Multiline", value => this.change(() => {
            const sections = parseDocument(this.state.document, this.state.format);
            this.state.format = value === "Single line" ? "single_line" : "multiline";
            this.state.document = formatDocument(sections, this.state.format);
        }), { values: ["Multiline", "Single line"] });
        this.document = this.multiline("prompt_document", this.state.document,
            value => {
                if (value !== this.state.document) this.change(() => { this.state.document = value; });
            }, () => this.state.document_height);
        this.resizable(this.document, () => this.state.document_height, height => { this.state.document_height = height; });
        this.add("button", "Copy document", null, () => this.copy(this.state.document));
    }

    createFields() {
        for (const field of this.fields) {
            for (const widget of [field.header, field.text]) {
                if (this.node.removeWidget) this.node.removeWidget(widget);
                else {
                    const index = this.node.widgets.indexOf(widget);
                    if (index >= 0) this.node.widgets.splice(index, 1);
                }
                widget.onRemove?.();
                (widget.element ?? textarea(widget))?.remove();
            }
        }
        this.fields = this.state.sections.map((section, index) => {
            const header = this.sectionHeader(index);
            const text = this.multiline(`text_${index + 1}`, section.text,
                value => {
                    if (value !== this.state.sections[index]?.text) {
                        this.change(() => { this.state.sections[index].text = value; }, true);
                    }
                }, () => this.state.sections[index]?.height ?? 100);
            this.resizable(text, () => this.state.sections[index].height, height => { this.state.sections[index].height = height; });
            return { id: section.id, header, text };
        });
        // Place dynamic native widgets immediately after input_count.
        const dynamic = this.fields.flatMap(field => [field.header, field.text]);
        const set = new Set(dynamic);
        const remaining = this.node.widgets.filter(widget => !set.has(widget));
        const at = remaining.indexOf(this.count) + 1;
        this.node.widgets.splice(0, this.node.widgets.length,
            ...remaining.slice(0, at), ...dynamic, ...remaining.slice(at));
        this.fit(false);
    }

    fit(shrink = false) {
        const minimum = this.node.computeSize();
        this.node.setSize([Math.max(420, this.node.size[0], minimum[0]),
            Math.max(minimum[1], shrink ? 0 : this.node.size[1])]);
        this.node.setDirtyCanvas?.(true, true);
    }

    message(text, error = false) {
        this.node.perfectorError = error ? text : null;
        this.node.boxcolor = error ? "#b44" : this.originalBoxColor;
        const input = this.kind === "clay" ? textarea(this.document) : textarea(this.preview);
        if (input) input.title = error ? text : "";
        this.node.setDirtyCanvas?.(true, true);
    }

    load() {
        try {
            this.state = readState(this.storage.value, this.kind === "clay" ? "document" : "builder");
            this.error = null;
            this.sourceError = null;
            this.render();
            this.save();
        } catch (error) {
            this.error = error;
            this.message(error.message, true);
        }
    }

    save() {
        this.writing = true;
        try { this.storage.value = JSON.stringify(this.state); }
        finally { this.writing = false; }
        this.node.setDirtyCanvas?.(true, true);
    }

    change(update, publish = false) {
        if (this.rendering) return;
        const graph = this.node.graph;
        graph?.beforeChange?.(this.node);
        try {
            update();
            this.error = null;
            this.save(); this.render();
            if (this.kind === "clay") broadcast(this);
            else if (publish) this.publishFields();
        } catch (error) {
            this.error = error;
            this.message(error.message, true);
            if (this.kind === "clay") {
                this.rendering = true;
                this.format.value = this.state.format === "single_line" ? "Single line" : "Multiline";
                this.rendering = false;
                broadcast(this);
            }
        } finally { graph?.afterChange?.(this.node); }
    }

    render() {
        this.rendering = true;
        try {
            if (this.kind === "clay") {
                if (this.document.value !== this.state.document) this.document.value = this.state.document;
                this.format.value = this.state.format === "single_line" ? "Single line" : "Multiline";
                parseDocument(this.state.document, this.state.format);
                this.message("");
                return;
            }
            if (this.fields.length !== this.state.sections.length || this.fields.some((field, index) => field.id !== this.state.sections[index].id)) this.createFields();
            this.state.sections.forEach((section, index) => {
                const field = this.fields[index];
                const controls = field.header.controls;
                controls.shared.checked = section.shared;
                if (controls.title.value !== section.title) controls.title.value = section.title;
                controls.color.value = section.color ?? "#777777";
                controls.number.style.backgroundColor = section.color ?? "";
                if (section.color) {
                    const rgb = section.color.slice(1).match(/../g).map(value => parseInt(value, 16));
                    controls.number.style.color = rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 > 155 ? "#171717" : "#f4f4f4";
                } else controls.number.style.color = "";
                field.header.element.style.borderLeftColor = section.color ?? "transparent";
                const input = textarea(field.text);
                if (input) {
                    input.style.borderLeft = section.color ? `3px solid ${section.color}` : "";
                    input.style.backgroundColor = section.color ? `color-mix(in srgb, ${section.color} 10%, var(--comfy-input-bg, #222))` : "";
                }
                if (field.text.value !== section.text) field.text.value = section.text;
            });
            this.count.value = this.state.sections.length;
            this.separator.value = this.state.separator;
            this.preview.value = joinSections(this.state.sections, this.state.separator);
            const source = findSource(this.node);
            this.createButton.disabled = source.linked;
            const error = source.controller?.error ?? this.sourceError;
            if (error) {
                this.preview.value = "";
                this.message(error.message, true);
            } else {
                this.message("");
            }
            if (this.fitAfterRender) { this.fitAfterRender = false; this.fit(true); }
        } finally { this.rendering = false; }
    }

    publishFields() {
        const source = findSource(this.node).controller;
        if (!source) return;
        if (source.error) throw new Error("Fix the invalid Prompt Clay document before updating its groups.");
        source.state.document = formatDocument(this.state.sections.filter(section => section.shared), source.state.format);
        source.error = null;
        this.sourceError = null;
        source.save(); source.render(); this.render();
        broadcast(source, this);
    }

    syncSource() {
        if (this.kind !== "separator") return;
        const source = findSource(this.node).controller;
        this.sourceError = null;
        if (!source) { this.render(); return; }
        try {
            if (source.error) throw source.error;
            const previousCount = this.state.sections.length;
            this.state.sections = mergeSharedSections(this.state.sections, parseDocument(source.state.document, source.state.format)).map(prepareSection);
            if (this.state.sections.length > previousCount) this.state.parked.splice(0, this.state.sections.length - previousCount);
            if (this.state.sections.length !== previousCount) this.fitAfterRender = true;
            this.save(); this.render();
        } catch (error) {
            this.sourceError = error;
            this.render();
        }
    }

    createClayNode() {
        const graph = this.node.graph;
        const source = globalThis.LiteGraph?.createNode(CLAY);
        if (!graph || !source) {
            this.message("Add Prompt Clay and connect sections → sections.", true);
            return;
        }
        graph.beforeChange?.();
        try {
            source.pos = [this.node.pos[0] - Math.max(source.size[0] + 70, 490), this.node.pos[1]];
            graph.add(source);
            const controller = byNode.get(source);
            if (!controller) throw new Error("Could not initialize Prompt Clay.");
            controller.state.document = formatDocument(this.state.sections.filter(section => section.shared));
            controller.save(); controller.render();
            source.connect(0, this.node, this.node.inputs.findIndex(input => input.name === "sections"));
            this.syncSource();
        } catch (error) { this.message(error.message, true); }
        finally { graph.afterChange?.(); }
    }

    async copy(text) {
        try {
            await navigator.clipboard.writeText(text);
            this.message("Copied");
        } catch { this.message("Select the text and press Ctrl+C."); }
    }
}

app.registerExtension({
    name: "NodePerfector.Prompts",
    setup() {
        if (document.getElementById("perfector-prompt-controls")) return;
        const style = document.createElement("link");
        style.id = "perfector-prompt-controls";
        style.rel = "stylesheet";
        style.href = new URL("./prompt_controls.css", import.meta.url).href;
        document.head.append(style);
    },
    nodeCreated(node) {
        const type = node.comfyClass ?? node.constructor.comfyClass ?? node.type;
        if (type !== SEPARATOR && type !== CLAY) return;
        const controller = new PromptController(node, type === SEPARATOR ? "separator" : "clay");
        byNode.set(node, controller);
        controllers.add(controller);
    },
    afterConfigureGraph() {
        for (const controller of controllers) controller.load();
        for (const controller of controllers) if (controller.kind === "separator") controller.syncSource();
    },
});
