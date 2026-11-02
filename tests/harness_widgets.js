// A small stand-in for ComfyWidgets.STRING's DOM host, used only by browser tests.
// The graph and all canvas widgets (number, text, toggle, button) are real LiteGraph.
export const ComfyWidgets = {
    STRING(node, name, spec, app) {
        const element = document.createElement("textarea");
        element.className = "comfy-multiline-input";
        element.value = spec[1].default ?? "";
        const widget = {
            name, type: "customtext", element, options: {},
            get value() { return element.value; },
            set value(value) { if (element.value !== value) element.value = value; },
            computeSize: width => [width, 100],
            draw(ctx, currentNode, width, y, height) {
                const scale = app.canvas.ds.scale;
                const offset = app.canvas.ds.offset;
                element.dataset.nodeId = currentNode.id;
                element.style.left = ((currentNode.pos[0] + 10 + offset[0]) * scale) + "px";
                element.style.top = ((currentNode.pos[1] + y + 4 + offset[1]) * scale) + "px";
                element.style.width = (width - 20) + "px";
                const actualHeight = currentNode.widgets.find(item => item.element === element)?.computedHeight ?? height;
                element.style.height = Math.max(40, actualHeight - 8) + "px";
                element.style.transformOrigin = "0 0";
                element.style.transform = `scale(${scale})`;
            },
            onRemove() { element.remove(); },
        };
        element.addEventListener("input", () => widget.callback?.(widget.value));
        document.getElementById("scene").append(element);
        node.addCustomWidget(widget);
        return { widget };
    },
};
