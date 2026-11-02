// Stand-in for ComfyUI's DOM mounting. The graph and canvas controls are real LiteGraph.
export function addDOMWidget(node, name, type, element, options, app) {
    const widget = {
        name, type, element, options,
        get value() { return options.getValue?.() ?? ""; },
        set value(value) { options.setValue?.(value); },
        computeSize: width => [width, options.getHeight?.() ?? 100],
        draw(ctx, currentNode, width, y) {
            const scale = app.canvas.ds.scale;
            const offset = app.canvas.ds.offset;
            const margin = options.margin ?? 10;
            element.dataset.nodeId = currentNode.id;
            element.style.position = "absolute";
            element.style.left = ((currentNode.pos[0] + margin + offset[0]) * scale) + "px";
            element.style.top = ((currentNode.pos[1] + y + margin + offset[1]) * scale) + "px";
            element.style.width = (width - margin * 2) + "px";
            const actualHeight = currentNode.widgets.find(item => item.element === element)?.computedHeight ?? 100;
            element.style.height = Math.max(20, actualHeight - margin * 2) + "px";
            element.style.transformOrigin = "0 0";
            element.style.transform = `scale(${scale})`;
        },
        onRemove() { element.remove(); },
    };
    document.getElementById("scene").append(element);
    node.addCustomWidget(widget);
    return widget;
}

export const ComfyWidgets = {
    STRING(node, name, spec, app) {
        const element = document.createElement("textarea");
        element.className = "comfy-multiline-input";
        element.value = spec[1].default ?? "";
        const widget = addDOMWidget(node, name, "customtext", element, {
            getValue: () => element.value,
            setValue: value => { if (element.value !== value) element.value = value; },
        }, app);
        element.addEventListener("input", () => widget.callback?.(widget.value));
        return { widget };
    },
};
