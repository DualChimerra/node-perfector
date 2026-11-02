// Local test server only. Not loaded or needed by ComfyUI.
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const schemas = spawnSync(process.env.PYTHON ?? (process.platform === "win32" ? "py" : "python3"),
    [path.join(root, "tests", "export_definitions.py")], { encoding: "utf8" });
if (schemas.status !== 0) throw new Error(schemas.stderr);
const contentTypes = { ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".html": "text/html" };
http.createServer(async (request, response) => {
    try {
        let route = new URL(request.url, "http://localhost").pathname;
        if (route === "/object_info") { response.setHeader("Content-Type", "application/json"); response.end(schemas.stdout); return; }
        if (route === "/scripts/app.js") route = "/tests/harness_app.js";
        if (route === "/scripts/widgets.js") route = "/tests/harness_widgets.js";
        if (route === "/") route = "/tests/harness.html";
        const target = path.resolve(root, "." + decodeURIComponent(route));
        if (!target.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
        const data = await readFile(target);
        response.setHeader("Content-Type", contentTypes[path.extname(target)] ?? "application/octet-stream");
        response.end(data);
    } catch { response.writeHead(404).end(); }
}).listen(8189, "127.0.0.1");
