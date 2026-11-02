"""Export the real Python node schema for the browser integration harness."""
from test_nodes import package
import json

print(json.dumps({key: {"name": key, "display_name": package.NODE_DISPLAY_NAME_MAPPINGS[key],
    "input": cls.INPUT_TYPES(), "output": cls.RETURN_TYPES, "output_name": cls.RETURN_NAMES}
    for key, cls in package.NODE_CLASS_MAPPINGS.items()}, ensure_ascii=True))
