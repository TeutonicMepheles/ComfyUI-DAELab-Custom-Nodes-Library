import importlib.util
import pathlib
import sys
import types
import unittest


class NodeOutputStub:
    def __init__(self, *args, **_kwargs):
        self.args = args


io_stub = types.SimpleNamespace(ComfyNode=object, NodeOutput=NodeOutputStub)
latest_stub = types.ModuleType("comfy_api.latest")
latest_stub.io = io_stub
comfy_api_stub = types.ModuleType("comfy_api")
comfy_api_stub.latest = latest_stub
sys.modules.setdefault("comfy_api", comfy_api_stub)
sys.modules.setdefault("comfy_api.latest", latest_stub)

NODE_PATH = pathlib.Path(__file__).parents[1] / "nodes" / "badge_relief_prompt" / "node.py"
SPEC = importlib.util.spec_from_file_location("badge_relief_prompt_node", NODE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class BadgeReliefPromptTests(unittest.TestCase):
    def test_defines_six_monotonic_relief_levels(self):
        self.assertEqual(tuple(MODULE.RELIEF_LEVELS), (0, 1, 2, 3, 4, 5))
        self.assertEqual(MODULE.DEFAULT_RELIEF_LEVEL, 2)
        self.assertEqual(MODULE.RELIEF_LEVELS[0]["label"], "完全平面")
        self.assertEqual(MODULE.RELIEF_LEVELS[5]["label"], "高浮雕")

    def test_normalizes_external_values_to_supported_segments(self):
        self.assertEqual(MODULE.normalize_relief_level(-100), 0)
        self.assertEqual(MODULE.normalize_relief_level(2.5), 3)
        self.assertEqual(MODULE.normalize_relief_level(2.6), 3)
        self.assertEqual(MODULE.normalize_relief_level(100), 5)
        self.assertEqual(MODULE.normalize_relief_level("invalid"), 2)

    def test_prompt_changes_only_surface_height_and_locks_design(self):
        prompt = MODULE.build_relief_prompt(3)

        self.assertIn("LEVEL 3: 中浮雕", prompt)
        self.assertIn("changing ONLY the physical surface-relief height", prompt)
        self.assertIn("Modify only the Z-axis elevation", prompt)
        self.assertIn("Preserve the exact existing material identity", prompt)
        self.assertIn("Preserve all text verbatim", prompt)
        self.assertIn("Preserve every original base color", prompt)
        self.assertIn("Preserve every graphic shape", prompt)
        self.assertIn("Do not move, expand, shrink, warp, redraw", prompt)
        self.assertIn("localized highlights, self-shadows, and ambient occlusion", prompt)
        self.assertIn("not a redesign, material change, recoloring", prompt)

    def test_every_level_uses_the_same_immutable_constraint_block(self):
        for level, spec in MODULE.RELIEF_LEVELS.items():
            with self.subTest(level=level):
                prompt = MODULE.build_relief_prompt(level)
                self.assertIn(f"LEVEL {level}: {spec['label']}", prompt)
                self.assertIn(spec["description"], prompt)
                self.assertIn("IMMUTABLE DESIGN CONSTRAINTS", prompt)
                self.assertIn("GEOMETRY RULE", prompt)
                self.assertIn("LIGHTING RULE", prompt)

    def test_execute_returns_the_compiled_prompt(self):
        output = MODULE.BadgeReliefPrompt.execute(4)

        self.assertEqual(output.args, (MODULE.build_relief_prompt(4),))

    def test_node_registration_is_stable(self):
        self.assertIs(
            MODULE.NODE_CLASS_MAPPINGS["BadgeReliefPrompt"],
            MODULE.BadgeReliefPrompt,
        )
        self.assertEqual(
            MODULE.NODE_DISPLAY_NAME_MAPPINGS["BadgeReliefPrompt"],
            "徽章浮雕强度 / Badge Relief",
        )


if __name__ == "__main__":
    unittest.main()
