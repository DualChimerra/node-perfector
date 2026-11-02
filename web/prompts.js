import { app } from "../../scripts/app.js";
import { ComfyWidgets } from "../../scripts/widgets.js";
import { defaultState, readState, parseDocument, formatDocument, joinSections,
    resizeSections, mergeSharedSections, MAX_SECTIONS } from "./prompt_model.js";

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
            : { version: 1, document: formatDocument(defaultState().sections) };
        this.fields = [];
        // Native ComfyUI widgets throughout: number, toggle, text, button,
        // and the standard multiline STRING widget supplied by ComfyWidgets.
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
        this.status = this.add("button", "status", "", () => {});
        this.status.disabled = true;
        this.status.options.readOnly = true;

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
        this.fit();
    }

    add(type, name, value, callback, options = {}) {
        return transient(this.node.addWidget(type, name, value, callback, options));
    }

    multiline(name, value, callback, height, readOnly = false) {
        const widget = transient(ComfyWidgets.STRING(this.node, name,
            ["STRING", { default: value, multiline: true, dynamicPrompts: false }], app).widget);
        widget.options.getMinHeight = () => height;
        widget.computeSize = width => [width, height];
        const input = textarea(widget);
        if (input) {
            input.readOnly = readOnly;
            input.spellcheck = false;
            input.setAttribute("aria-label", name);
            if (callback) input.addEventListener("input", () => {
                if (!this.rendering) callback(input.value);
            });
        }
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
            value => this.change(() => resizeSections(this.state, value), true),
            { min: 1, max: MAX_SECTIONS, step: 10, precision: 0 });
        this.separator = this.add("text", "separator", ", ",
            value => this.change(() => { this.state.separator = value; }));
        this.includeTitles = this.add("toggle", "include_titles_in_prompt", false,
            value => this.change(() => { this.state.include_titles = value; }));
        this.previewDivider();
        this.preview = this.multiline("final_prompt", "", null, 140, true);
        this.createButton = this.add("button", "Create Prompt Clay", null, () => this.createClayNode());
        this.add("button", "Copy final prompt", null, () => this.copy(this.preview.value));
    }

    createClay() {
        this.document = this.multiline("prompt_document", this.state.document,
            value => this.change(() => { this.state.document = value; }), 440);
        this.add("button", "Copy document", null, () => this.copy(this.state.document));
    }

    createFields() {
        for (const field of this.fields) {
            for (const widget of Object.values(field)) {
                if (this.node.removeWidget) this.node.removeWidget(widget);
                else {
                    const index = this.node.widgets.indexOf(widget);
                    if (index >= 0) this.node.widgets.splice(index, 1);
                }
                widget.onRemove?.();
                textarea(widget)?.remove();
            }
        }
        this.fields = this.state.sections.map((section, index) => {
            const number = String(index + 1).padStart(2, "0");
            const shared = this.add("toggle", `${number} · share with Prompt Clay`, section.shared,
                value => this.change(() => { this.state.sections[index].shared = value; }, true),
                { on: "shared", off: "local" });
            const title = this.add("text", `${number} · title`, section.title,
                value => this.change(() => { this.state.sections[index].title = value; }, true));
            const text = this.multiline(`text_${index + 1}`, section.text,
                value => this.change(() => { this.state.sections[index].text = value; }, true), 100);
            return { shared, title, text };
        });
        // Place dynamic native widgets immediately after input_count.
        const dynamic = this.fields.flatMap(field => Object.values(field));
        const set = new Set(dynamic);
        const remaining = this.node.widgets.filter(widget => !set.has(widget));
        const at = remaining.indexOf(this.count) + 1;
        this.node.widgets.splice(0, this.node.widgets.length,
            ...remaining.slice(0, at), ...dynamic, ...remaining.slice(at));
        this.fit();
    }

    fit() {
        const minimum = this.node.computeSize();
        const preferred = this.kind === "clay" ? 560 : this.state.sections.length * 155 + 330;
        this.node.setSize([Math.max(420, this.node.size[0], minimum[0]), Math.max(minimum[1], preferred)]);
        this.node.setDirtyCanvas?.(true, true);
    }

    message(text, error = false) {
        this.status.value = error ? "Error: " + text : text;
        this.status.label = this.status.value.length > 58 ? this.status.value.slice(0, 55) + "…" : this.status.value;
        this.status.options.tooltip = this.status.value;
        this.node.setDirtyCanvas?.(true, true);
    }

    load() {
        try {
            this.state = readState(this.storage.value, this.kind === "clay" ? "document" : "builder");
            this.error = null;
            this.sourceError = null;
            this.render();
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
            if (this.kind === "clay") broadcast(this);
        } finally { graph?.afterChange?.(this.node); }
    }

    render() {
        this.rendering = true;
        try {
            if (this.kind === "clay") {
                if (this.document.value !== this.state.document) this.document.value = this.state.document;
                this.message(`${parseDocument(this.state.document).length} groups · sections → Prompt Separator`);
                return;
            }
            if (this.fields.length !== this.state.sections.length) this.createFields();
            this.state.sections.forEach((section, index) => {
                const field = this.fields[index];
                field.shared.value = section.shared;
                field.title.value = section.title;
                if (field.text.value !== section.text) field.text.value = section.text;
            });
            this.count.value = this.state.sections.length;
            this.separator.value = this.state.separator;
            this.includeTitles.value = this.state.include_titles;
            this.preview.value = joinSections(this.state.sections, this.state.separator, this.state.include_titles);
            const source = findSource(this.node);
            this.createButton.disabled = source.linked;
            const count = this.state.sections.filter(section => section.shared).length;
            const error = source.controller?.error ?? this.sourceError;
            if (error) {
                this.preview.value = "";
                this.message(error.message, true);
            } else {
                this.message(source.controller ? `Synced · ${count} shared · All fields → final prompt`
                    : source.linked ? "Source preview updates after execution"
                        : `${count} shared · All fields → final prompt`);
            }
        } finally { this.rendering = false; }
    }

    publishFields() {
        const source = findSource(this.node).controller;
        if (!source) return;
        source.state.document = formatDocument(this.state.sections.filter(section => section.shared));
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
            this.state.sections = mergeSharedSections(this.state.sections, parseDocument(source.state.document));
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
