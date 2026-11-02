"""Pure text operations. No ComfyUI or third-party imports required."""

import json
import re

MAX_SECTIONS = 64
DEFAULT_TITLES = ("Quality", "Subject", "Artists / style", "Pose & action", "Details")
HEADING = re.compile(r"^##(?:[ \t](.*))?$")
INLINE_HEADING = re.compile(r"(?:^|[ \t])##[ \t]+((?:\\.|[^\\:\r\n])*):[ \t]?")


def default_state():
    return {
        "version": 1,
        "sections": [{"title": title, "text": "", "shared": True} for title in DEFAULT_TITLES],
        "parked": [],
        "separator": ", ",
        "preview_height": 140,
    }


def read_json(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (ValueError, TypeError) as error:
            raise ValueError("Node Perfector: invalid saved data.") from error
    if not isinstance(value, dict) or value.get("version") != 1:
        raise ValueError("Node Perfector: unsupported saved data format.")
    return value


def normalize_sections(sections, allow_empty=False):
    if not isinstance(sections, list) or not (0 if allow_empty else 1) <= len(sections) <= MAX_SECTIONS:
        raise ValueError(f"Node Perfector: expected {0 if allow_empty else 1}–{MAX_SECTIONS} fields.")
    result = []
    for section in sections:
        if not isinstance(section, dict):
            raise ValueError("Node Perfector: invalid text field.")
        title, text = section.get("title", ""), section.get("text", "")
        if not isinstance(title, str) or not isinstance(text, str):
            raise ValueError("Node Perfector: titles and field content must be strings.")
        if "\n" in title or "\r" in title:
            raise ValueError("Node Perfector: titles must use a single line.")
        shared = section.get("shared", True)
        if not isinstance(shared, bool):
            raise ValueError("Node Perfector: the share switch must be a boolean.")
        normalized = {"title": title.strip(), "text": text.replace("\r\n", "\n").replace("\r", "\n"), "shared": shared}
        for key in ("id", "height", "color"):
            if key in section:
                normalized[key] = section[key]
        result.append(normalized)
    return result


def builder_state(value):
    value = read_json(value)
    sections = normalize_sections(value.get("sections"))
    separator = value.get("separator", ", ")
    if not isinstance(separator, str):
        raise ValueError("Node Perfector: invalid separator.")
    return {**value, "sections": sections, "separator": separator}


def unescape_inline(text):
    escapes = {"n": "\n", "r": "\r", "t": "\t"}
    return re.sub(r"\\([\\nrt:#])", lambda match: escapes.get(match.group(1), match.group(1)), text)


def escape_inline(text):
    return text.replace("\\", "\\\\").replace("\n", "\\n").replace("##", "\\##")


def parse_document(document, document_format="multiline"):
    if not isinstance(document, str):
        raise ValueError("Node Perfector: the document must be a string.")
    if document_format == "single_line":
        headings = list(INLINE_HEADING.finditer(document))
        if not headings:
            return normalize_sections([{"title": "", "text": unescape_inline(document)}]) if document.strip() else []
        if document[:headings[0].start()].strip():
            raise ValueError("Node Perfector: start each group with ## Title:.")
        return normalize_sections([
            {"title": unescape_inline(heading.group(1)).strip(),
             "text": unescape_inline(document[heading.end():headings[index + 1].start() if index + 1 < len(headings) else len(document)])}
            for index, heading in enumerate(headings)
        ], allow_empty=True)
    sections, lines, title = [], [], None

    def flush():
        if title is not None or any(line.strip() for line in lines):
            sections.append({"title": title or "", "text": "\n".join(lines).strip("\n")})

    for line in document.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        match = HEADING.fullmatch(line)
        if match:
            flush()
            title, lines = (match.group(1) or "").strip(), []
        else:
            if line.startswith("\\\\") or (line.startswith("\\") and HEADING.fullmatch(line[1:])):
                line = line[1:]
            lines.append(line)
    flush()
    return normalize_sections(sections, allow_empty=True)


def format_document(sections, document_format="multiline"):
    if document_format == "single_line":
        return " ".join("## " + escape_inline(section["title"]).replace(":", "\\:") + ": " + escape_inline(section["text"])
            for section in normalize_sections(sections, allow_empty=True))
    blocks = []
    for section in normalize_sections(sections, allow_empty=True):
        lines = section["text"].strip("\n").split("\n")
        escaped = ["\\" + line if line.startswith("\\") or HEADING.fullmatch(line) else line for line in lines]
        heading = "##" + (" " + section["title"] if section["title"] else "")
        blocks.append(heading + "\n" + "\n".join(escaped))
    return "\n\n".join(blocks)


def decode_separator(value):
    """Decode only documented escapes; keep unknown escapes and Unicode intact."""
    escapes = {"n": "\n", "r": "\r", "t": "\t", "\\": "\\"}
    return re.sub(r"\\([nrt\\])", lambda match: escapes[match.group(1)], value)


def join_sections(sections, separator=", "):
    pieces = []
    for section in normalize_sections(sections):
        text = section["text"].strip()
        if text:
            pieces.append(text)
    return decode_separator(separator).join(pieces)


def merge_shared_sections(local, incoming):
    """Replace only opted-in sections in order; keep private sections in place."""
    local = normalize_sections(local)
    incoming = iter(normalize_sections(incoming, allow_empty=True))
    result = []
    for section in local:
        if not section["shared"]:
            result.append(section)
        else:
            replacement = next(incoming, None)
            if replacement is not None:
                result.append({**section, "title": replacement["title"], "text": replacement["text"], "shared": True})
    result.extend({**section, "shared": True} for section in incoming)
    # The field node always has at least one editable field.
    return normalize_sections(result or [{"title": "", "text": "", "shared": True}])


DEFAULT_STATE_JSON = json.dumps(default_state(), ensure_ascii=False)
DEFAULT_DOCUMENT_JSON = json.dumps(
    {"version": 1, "document": format_document(default_state()["sections"])}, ensure_ascii=False
)
