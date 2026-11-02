import { LiteGraph, LGraph, LGraphNode, LGraphCanvas } from "/node_modules/@comfyorg/litegraph/dist/litegraph.es.js";
import { app } from "/scripts/app.js";
import { addDOMWidget } from "/tests/harness_widgets.js";
import "/web/prompts.js";

globalThis.LiteGraph = LiteGraph;
app.graph = new LGraph();
app.canvas = new LGraphCanvas(document.getElementById("graph"), app.graph);
app.canvas.background_image = null;
app.canvas.show_info = false;
app.canvas.ds.scale = 1;
app.canvas.ds.offset = [0, 0];
const definitions = await (await fetch("/object_info")).json();
const extension = app.extensions[0];
extension.setup?.();

for (const [type, definition] of Object.entries(definitions)) {
    class ComfyNode extends LGraphNode {
        constructor(title) {
            super(title);
            this.comfyClass = type;
            this.serialize_widgets = true;
            this.addWidget("text", "state", definition.input.required.state[1].default, () => {}, {});
            if (definition.input.optional) this.addInput("sections", definition.input.optional.sections[0]);
            this.addOutput(definition.output_name[0], definition.output[0]);
        }
        onNodeCreated() { extension.nodeCreated(this); }
        onRemoved() { for (const widget of this.widgets) widget.onRemove?.(); }
        addDOMWidget(name, type, element, options) { return addDOMWidget(this, name, type, element, options, app); }
    }
    ComfyNode.title = definition.display_name;
    LiteGraph.registerNodeType(type, ComfyNode);
}
class ClipTextEncode extends LGraphNode {
    constructor() {
        super("CLIP Text Encode (Prompt)");
        this.addInput("clip", "CLIP");
        this.addInput("text", "STRING");
        this.addOutput("CONDITIONING", "CONDITIONING");
        this.size = [320, 120];
    }
}
LiteGraph.registerNodeType("CLIPTextEncode", ClipTextEncode);
const separator = LiteGraph.createNode("PerfectorPromptSeparator");
separator.pos = [530, 60];
app.graph.add(separator);
globalThis.harness = {
    app, extension, separator,
    source() { return app.graph._nodes.find(node => node.type === "PerfectorPromptClay"); },
    state(node = this.separator) { return JSON.parse(node.widgets[0].value); },
    widget(name, node = this.separator) { return node.widgets.find(widget => widget.name === name); },
    set(name, value, node = this.separator) {
        const widget = this.widget(name, node);
        if (!widget) {
            const field = /^(\d+) · (title|share with Prompt Clay)$/.exec(name);
            if (!field) throw new Error("Widget not found: " + name);
            const controls = this.widget("header_" + Number(field[1]), node).controls;
            const input = field[2] === "title" ? controls.title : controls.shared;
            if (field[2] === "title") input.value = value;
            else input.checked = value;
            input.dispatchEvent(new Event(field[2] === "title" ? "input" : "change"));
            app.canvas.draw(true, true);
            return;
        }
        widget.value = value;
        widget.callback?.(value, app.canvas, node, undefined, {});
        app.canvas.draw(true, true);
    },
    click(name, node = this.separator) { this.widget(name, node).callback?.(); app.canvas.draw(true, true); },
    point(name, node = this.separator) {
        app.canvas.draw(true, true);
        const widget = this.widget(name, node);
        return { x: node.pos[0] + node.size[0] / 2, y: node.pos[1] + widget.y + 10 };
    },
    save() { return structuredClone(app.graph.serialize()); },
    restore(data) {
        app.configuringGraph = true;
        app.graph.configure(data);
        app.configuringGraph = false;
        this.separator = app.graph._nodes.find(node => node.type === "PerfectorPromptSeparator");
        extension.afterConfigureGraph();
        app.canvas.draw(true, true);
    },
};
app.canvas.draw(true, true);
globalThis.harnessReady = true;
