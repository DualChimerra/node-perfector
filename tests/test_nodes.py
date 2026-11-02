import importlib.util
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("node_perfector", ROOT / "__init__.py", submodule_search_locations=[str(ROOT)])
package = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = package
spec.loader.exec_module(package)
from node_perfector import prompt_core as core
from node_perfector.nodes import PromptClay, PromptSeparator

FIXTURES = json.loads((ROOT / "tests" / "fixtures.json").read_text(encoding="utf-8"))


class TextRulesTests(unittest.TestCase):
    def test_shared_fixtures(self):
        for fixture in FIXTURES["documents"]:
            with self.subTest(fixture["name"]):
                self.assertEqual(core.parse_document(fixture["document"]), fixture["expected"])
                self.assertEqual(core.parse_document(core.format_document(fixture["expected"])), fixture["expected"])

    def test_switches_do_not_filter_output(self):
        state = core.default_state()
        state["sections"] = [{"title": "Quality", "text": "always", "shared": False}, {"title": "Subject", "text": "forest", "shared": True}]
        result = PromptSeparator().build(json.dumps(state))
        self.assertEqual(result["result"], ("always, forest",))
        self.assertEqual(result["ui"]["text"], ["always, forest"])

    def test_connected_clay_preserves_private_fields(self):
        for fixture in FIXTURES["merges"]:
            with self.subTest(fixture["name"]):
                state = {**core.default_state(), "sections": fixture["local"]}
                document = core.format_document(fixture["incoming"])
                sections, = PromptClay().parse(json.dumps({"version": 1, "document": document}))
                result = PromptSeparator().build(json.dumps(state), sections)
                self.assertEqual(result["result"][0], fixture["output"])

    def test_delimiters_titles_and_blank_blocks(self):
        sections = [{"title": "Quality", "text": " a "}, {"title": "Empty", "text": " \n "}, {"title": "", "text": "b"}]
        self.assertEqual(core.join_sections(sections, "\\n", True), "Quality: a\nb")
        self.assertEqual(core.join_sections(sections, ""), "ab")
        self.assertEqual(core.decode_separator(r"\\n"), r"\n")
        self.assertEqual(core.decode_separator(" → "), " → ")
        self.assertEqual(core.decode_separator(r"\q"), r"\q")

    def test_limits_and_invalid_data_fail_explicitly(self):
        with self.assertRaises(ValueError):
            core.parse_document("\n".join("## A" for _ in range(65)))
        with self.assertRaises(ValueError):
            core.builder_state("invalid JSON")
        with self.assertRaises(ValueError):
            core.normalize_sections([{"title": "a\nb", "text": ""}])
        with self.assertRaises(ValueError):
            core.normalize_sections([{"text": "", "shared": "false"}])
        with self.assertRaises(ValueError):
            core.merge_shared_sections([{"text": "keep", "shared": False}], [{"text": "new"}] * 64)

    def test_empty_editor_and_all_empty_output(self):
        self.assertEqual(PromptClay().parse('{"version":1,"document":""}'), ([],))
        self.assertEqual(PromptSeparator().build(core.DEFAULT_STATE_JSON)["result"], ("",))
        self.assertEqual(len(core.merge_shared_sections([{"text": ""}], [])), 1)

    def test_registration_and_dependency_free_import(self):
        self.assertEqual(set(package.NODE_CLASS_MAPPINGS), {"PerfectorPromptSeparator", "PerfectorPromptClay"})
        self.assertEqual(PromptSeparator.RETURN_TYPES, ("STRING",))
        self.assertEqual(PromptSeparator.INPUT_TYPES()["optional"]["sections"][0], PromptClay.RETURN_TYPES[0])
        self.assertTrue((ROOT / package.WEB_DIRECTORY).is_dir())

    def test_example_outputs_expected_text_without_models(self):
        workflow = json.loads((ROOT / "examples" / "prompt-editing.json").read_text(encoding="utf-8"))
        clay, separator, encoder = workflow["nodes"]
        source, = PromptClay().parse(clay["widgets_values"][0])
        output = PromptSeparator().build(separator["widgets_values"][0], source)["result"][0]
        self.assertEqual(output, "masterpiece, best quality, detailed, a quiet forest path, morning mist, soft golden light, peaceful atmosphere")
        self.assertEqual(workflow["links"][1][-1], "STRING")
        self.assertEqual(encoder["inputs"][1]["name"], "text")


if __name__ == "__main__":
    unittest.main()
