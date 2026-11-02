from .prompt_core import (
    DEFAULT_DOCUMENT_JSON,
    DEFAULT_STATE_JSON,
    builder_state,
    join_sections,
    merge_shared_sections,
    parse_document,
    read_json,
)


class PromptSeparator:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {"state": ("STRING", {"default": DEFAULT_STATE_JSON, "dynamicPrompts": False})},
            "optional": {"sections": ("PERFECTOR_PROMPT_SECTIONS", {"forceInput": True})},
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    OUTPUT_TOOLTIPS = ("Final prompt → text input of CLIP Text Encode.",)
    FUNCTION = "build"
    CATEGORY = "Node Perfector/Prompt"
    DESCRIPTION = "Edit, color, resize, and reorder named prompt fields. Share switches control inclusion in Prompt Clay only; all non-empty fields remain in the final prompt. Click a field number to choose its color."
    SEARCH_ALIASES = ["prompt builder", "join text", "промпт", "текстовые поля"]

    def build(self, state, sections=None):
        settings = builder_state(state)
        source = settings["sections"] if sections is None else merge_shared_sections(settings["sections"], sections)
        text = join_sections(source, settings["separator"])
        return {"ui": {"text": [text], "sections": source}, "result": (text,)}


class PromptClay:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"state": ("STRING", {"default": DEFAULT_DOCUMENT_JSON, "dynamicPrompts": False})}}

    RETURN_TYPES = ("PERFECTOR_PROMPT_SECTIONS",)
    RETURN_NAMES = ("sections",)
    OUTPUT_TOOLTIPS = ("Named groups → sections input of Prompt Separator.",)
    FUNCTION = "parse"
    CATEGORY = "Node Perfector/Prompt"
    DESCRIPTION = "Shape prompts with AI using a document organized by ## Headings or single-line ## Heading: text groups. Paste a revision back to update the connected Prompt Separator."
    SEARCH_ALIASES = ["prompt editor", "document", "общий редактор", "промпт"]

    def parse(self, state):
        value = read_json(state)
        return (parse_document(value.get("document"), value.get("format", "multiline")),)


NODE_CLASS_MAPPINGS = {
    "PerfectorPromptSeparator": PromptSeparator,
    "PerfectorPromptClay": PromptClay,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "PerfectorPromptSeparator": "Prompt Separator",
    "PerfectorPromptClay": "Prompt Clay",
}
