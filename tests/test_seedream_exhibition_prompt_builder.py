import importlib.util
import pathlib
import sys
import types
import unittest


class NodeOutputStub:
    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs


io_stub = types.SimpleNamespace(ComfyNode=object, NodeOutput=NodeOutputStub)
latest_stub = types.ModuleType("comfy_api.latest")
latest_stub.io = io_stub
comfy_api_stub = types.ModuleType("comfy_api")
comfy_api_stub.latest = latest_stub
sys.modules.setdefault("comfy_api", comfy_api_stub)
sys.modules.setdefault("comfy_api.latest", latest_stub)

NODE_PATH = pathlib.Path(__file__).parents[1] / "nodes" / "seedream_exhibition_prompt_builder" / "node.py"
SPEC = importlib.util.spec_from_file_location("seedream_exhibition_prompt_builder_node", NODE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SeedreamExhibitionPromptBuilderTests(unittest.TestCase):
    def execute(self, **overrides):
        values = {
            "style_id": "航天科技",
            "tone": "标准",
            "primary_color": "#567df0",
            "secondary_color": "#d0d5dd",
            "base_prompt": "BASE_PROMPT_SENTINEL",
            "additional_details": MODULE.DEFAULT_ADDITIONAL_DETAILS,
            "use_theme_template": True,
            "use_space_reference": True,
            "include_people_placeholder": True,
            "use_element_reference": True,
            "lock_edit_region": True,
        }
        values.update(overrides)
        return MODULE.SeedreamExhibitionPromptBuilder.execute(**values).args[0]

    def test_template_bypass_returns_base_prompt_verbatim(self):
        raw = "  第一行。\n\n第二行保留  连续空格！  "
        self.assertEqual(self.execute(use_theme_template=False, base_prompt=raw), raw)
        self.assertEqual(self.execute(use_theme_template="false", base_prompt=raw), raw)
        self.assertEqual(self.execute(use_theme_template=False, base_prompt=""), "")

    def test_template_output_ignores_base_and_uses_five_sections(self):
        prompt = self.execute()
        paragraphs = prompt.split("\n\n")

        self.assertEqual(len(paragraphs), 5)
        self.assertNotIn("BASE_PROMPT_SENTINEL", prompt)
        self.assertTrue(all(paragraph.strip() for paragraph in paragraphs))
        self.assertIn("精密构造线", paragraphs[2])
        self.assertIn("明亮科技蓝（#567DF0）", paragraphs[3])
        self.assertIn("低饱和蓝灰色（#D0D5DD）", paragraphs[3])
        self.assertNotIn("不额外添加未要求的主展品", prompt)
        self.assertNotIn("保持现有空间结构和展陈元素", prompt)

    def test_disabling_all_references_omits_reference_section_and_child_rules(self):
        prompt = self.execute(
            use_space_reference=False,
            include_people_placeholder=True,
            use_element_reference=False,
            lock_edit_region=True,
        )
        paragraphs = prompt.split("\n\n")

        self.assertEqual(len(paragraphs), 4)
        self.assertTrue(paragraphs[0].startswith("创建一张航天科技展厅"))
        self.assertNotIn("参考图", prompt)
        self.assertNotIn("游客", prompt)
        self.assertNotIn("展陈物件", prompt)

    def test_people_rule_depends_on_space_reference(self):
        prompt = self.execute(
            use_space_reference=True,
            include_people_placeholder=False,
            use_element_reference=False,
        )

        self.assertIn("相机机位、视角、透视关系和画面构图", prompt)
        self.assertNotIn("真实游客", prompt)
        self.assertNotIn("展陈物件", prompt)

    def test_element_position_rule_depends_on_element_reference(self):
        unlocked = self.execute(
            use_space_reference=False,
            use_element_reference=True,
            lock_edit_region=False,
        )
        locked = self.execute(
            use_space_reference=False,
            use_element_reference=True,
            lock_edit_region=True,
        )

        self.assertIn("在空间中合理放置", unlocked)
        self.assertNotIn("墙体、顶面、地面", unlocked)
        self.assertIn("位置、比例和空间关系", locked)

    def test_user_colors_override_theme_and_invalid_colors_fall_back(self):
        custom = self.execute(primary_color="#123abc", secondary_color="(210, 213, 221)")
        fallback = self.execute(
            style_id="商务",
            primary_color="invalid",
            secondary_color=None,
        )

        self.assertIn("#123ABC", custom)
        self.assertIn("#D2D5DD", custom)
        self.assertIn("#3A4A5C", fallback)
        self.assertIn("#B8A99A", fallback)

    def test_each_theme_uses_color_neutral_spatial_design_language(self):
        expectations = {
            "航天科技": "精密构造线",
            "商务": "模块化展陈界面",
            "党建": "庄重有序的叙事轴线",
        }
        forbidden = ("深蓝宇宙空间", "高级海报质感", "红色为主基调", "金色为点缀")

        for style_id, expected in expectations.items():
            with self.subTest(style_id=style_id):
                design_paragraph = self.execute(style_id=style_id).split("\n\n")[2]
                self.assertIn(expected, design_paragraph)
                self.assertFalse(any(value in design_paragraph for value in forbidden))

    def test_default_material_copy_is_unambiguous(self):
        self.assertIn("高抛光水磨石为主，结合局部PVC地材", MODULE.DEFAULT_ADDITIONAL_DETAILS)
        self.assertNotIn("水磨石，含PVC", MODULE.DEFAULT_ADDITIONAL_DETAILS)

    def test_legacy_corrupted_boolean_values_fall_back_to_schema_defaults(self):
        prompt = self.execute(
            use_theme_template="legacy prompt text",
            use_space_reference="legacy prompt text",
            include_people_placeholder="legacy prompt text",
            use_element_reference="legacy prompt text",
            lock_edit_region="legacy prompt text",
        )

        self.assertIn("相机机位、视角、透视关系和画面构图", prompt)
        self.assertIn("真实游客", prompt)
        self.assertIn("位置、比例和空间关系", prompt)


if __name__ == "__main__":
    unittest.main()
