"""Rebuild the neutral, model-free workflow example."""
from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from prompt_core import default_state, format_document

state = default_state()
state["sections"] = [
    {"title": "Quality", "text": "masterpiece, best quality, detailed", "shared": False},
    {"title": "Subject", "text": "a quiet forest path, morning mist", "shared": True},
    {"title": "Lighting & mood", "text": "soft golden light, peaceful atmosphere", "shared": True},
]
document = {"version": 1, "document": format_document([section for section in state["sections"] if section["shared"]])}
workflow = {
    "last_node_id": 3,
    "last_link_id": 2,
    "nodes": [
        {"id": 1, "type": "PerfectorPromptClay", "pos": [50, 80], "size": [460, 755], "flags": {}, "order": 0, "mode": 0,
         "inputs": [], "outputs": [{"name": "sections", "type": "PERFECTOR_PROMPT_SECTIONS", "links": [1], "slot_index": 0}],
         "properties": {"Node name for S&R": "PerfectorPromptClay"}, "widgets_values": [json.dumps(document, ensure_ascii=False)]},
        {"id": 2, "type": "PerfectorPromptSeparator", "pos": [600, 80], "size": [460, 1065], "flags": {}, "order": 1, "mode": 0,
         "inputs": [{"name": "sections", "type": "PERFECTOR_PROMPT_SECTIONS", "link": 1}],
         "outputs": [{"name": "text", "type": "STRING", "links": [2], "slot_index": 0}],
         "properties": {"Node name for S&R": "PerfectorPromptSeparator"}, "widgets_values": [json.dumps(state, ensure_ascii=False)]},
        {"id": 3, "type": "CLIPTextEncode", "pos": [1160, 80], "size": [400, 250], "flags": {}, "order": 2, "mode": 0,
         "inputs": [{"name": "clip", "type": "CLIP", "link": None}, {"name": "text", "type": "STRING", "link": 2, "widget": {"name": "text"}}],
         "outputs": [{"name": "CONDITIONING", "type": "CONDITIONING", "links": None}],
         "properties": {"Node name for S&R": "CLIPTextEncode"}, "widgets_values": [""]},
    ],
    "links": [[1, 1, 0, 2, 0, "PERFECTOR_PROMPT_SECTIONS"], [2, 2, 0, 3, 1, "STRING"]],
    "groups": [], "config": {}, "extra": {"ds": {"scale": 0.7, "offset": [0, 0]}}, "version": 0.4,
}
destination = ROOT / "examples" / "prompt-editing.json"
destination.parent.mkdir(exist_ok=True)
destination.write_text(json.dumps(workflow, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("Created examples/prompt-editing.json")
