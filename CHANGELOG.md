# Changelog

## 1.1.0 — 2026-11-02

- Put field number, editable title, sharing switch, and drag handle on one row.
- Add block colors and drag/keyboard reordering.
- Save independent text editor and preview heights; resize by dragging their lower edges.
- Preserve hidden fields and their layout through count changes and workflow reloads.
- Add editable single-line documents in Prompt Clay with lossless format switching.
- Remove the title-in-prompt toggle, final-prompt copy button, and status footers from both nodes.
- Keep existing workflows readable; field titles now stay out of the final CLIP prompt.

## 1.0.1 — 2026-11-02

- Fix prompt text disappearing after a field or node is renamed when edits arrive through ComfyUI widget callbacks.
- Handle both native widget callbacks and legacy textarea events in Prompt Separator and Prompt Clay without recording duplicate edits.
- Ignore callbacks from removed text fields so stale controls cannot overwrite current content.
- Preserve an invalid or unfinished Prompt Clay document when a local field is edited.
- Add regression tests and optional integration tests against a real ComfyUI server, including workflow reload and API execution.

## 1.0.0 — 2026-11-02

- Add Prompt Separator and Prompt Clay with named fields, selective sharing, synchronized editing, and a final prompt preview.
