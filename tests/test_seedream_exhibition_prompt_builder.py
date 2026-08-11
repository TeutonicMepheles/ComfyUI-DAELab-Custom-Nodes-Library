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

    def test_template_output_starts_with_base_and_uses_seven_sections(self):
        prompt = self.execute()
        paragraphs = prompt.split("\n\n")

        self.assertEqual(len(paragraphs), 7)
        self.assertEqual(paragraphs[0], "BASE_PROMPT_SENTINEL")
        self.assertTrue(all(paragraph.strip() for paragraph in paragraphs))
        self.assertIn("相机机位、视角、透视关系和画面构图", paragraphs[2])
        self.assertTrue(paragraphs[3].startswith("人物要求："))
        self.assertIn("精密构造线", paragraphs[4])
        self.assertIn("明亮科技蓝（#567DF0）", paragraphs[5])
        self.assertIn("低饱和蓝灰色（#D0D5DD）", paragraphs[5])
        self.assertNotIn("不额外添加未要求的主展品", prompt)
        self.assertNotIn("保持现有空间结构和展陈元素", prompt)

    def test_template_output_preserves_base_prompt_verbatim(self):
        raw = "  第一行。\n第二行保留  连续空格！  "
        prompt = self.execute(base_prompt=raw)

        self.assertTrue(prompt.startswith(f"{raw}\n\n"))

    def test_blank_base_prompt_does_not_add_an_empty_template_section(self):
        prompt = self.execute(base_prompt=" \n ")
        paragraphs = prompt.split("\n\n")

        self.assertEqual(len(paragraphs), 6)
        self.assertTrue(paragraphs[0].startswith("基于参考图"))

    def test_people_enabled_without_space_reference_adds_visitors_independently(self):
        prompt = self.execute(
            use_space_reference=False,
            include_people_placeholder=True,
            use_element_reference=False,
            lock_edit_region=True,
        )
        paragraphs = prompt.split("\n\n")

        self.assertEqual(len(paragraphs), 6)
        self.assertTrue(paragraphs[1].startswith("创建一张航天科技展厅"))
        self.assertNotIn("参考图", prompt)
        self.assertIn("主要参观动线上自然加入少量真实游客", prompt)
        self.assertIn("通常1至2名", prompt)
        self.assertIn("避免直视镜头或摆拍", prompt)
        self.assertNotIn("优先将", prompt)
        self.assertNotIn("展陈物件", prompt)

    def test_people_enabled_with_space_reference_replaces_or_adds_visitors(self):
        prompt = self.execute(
            use_space_reference=True,
            include_people_placeholder=True,
            use_element_reference=False,
        )

        self.assertIn("优先将参考图中已有的占位人物或示意人形替换为真实游客", prompt)
        self.assertIn("大致保持其位置、尺度和数量", prompt)
        self.assertIn("若参考图中没有占位人物", prompt)
        self.assertIn("不遮挡核心展项、标题、Logo和主要空间结构", prompt)

    def test_people_disabled_with_space_reference_removes_placeholders(self):
        prompt = self.execute(
            use_space_reference=True,
            include_people_placeholder=False,
            use_element_reference=False,
        )

        self.assertIn("相机机位、视角、透视关系和画面构图", prompt)
        self.assertIn("移除参考图中已有的占位人物或示意人形", prompt)
        self.assertIn("自然补全其后方空间", prompt)
        self.assertIn("不添加游客、工作人员、人物剪影或占位人形", prompt)
        self.assertNotIn("观看展项", prompt)
        self.assertNotIn("展陈物件", prompt)

    def test_people_disabled_without_space_reference_requires_an_empty_scene(self):
        prompt = self.execute(
            use_space_reference=False,
            include_people_placeholder=False,
            use_element_reference=False,
        )

        self.assertIn("人物要求：展厅内不出现游客、工作人员、人物剪影或占位人形", prompt)
        self.assertNotIn("参考图", prompt)
        self.assertNotIn("通常1至2名", prompt)

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
            style_id="党建",
            primary_color="invalid",
            secondary_color=None,
        )

        self.assertIn("#123ABC", custom)
        self.assertIn("#D2D5DD", custom)
        self.assertIn("#C33C3C", fallback)
        self.assertIn("#D4A843", fallback)

    def test_only_aerospace_and_party_building_styles_are_available(self):
        styles = MODULE.load_styles()

        self.assertEqual(list(styles), ["aerospace", "party_building"])
        self.assertEqual(list(MODULE.FALLBACK_STYLES), ["aerospace", "party_building"])
        self.assertEqual(MODULE.style_labels(styles), ["航天科技", "党建"])
        self.assertNotIn("商务", MODULE.style_labels(styles))

        legacy_business_prompt = self.execute(style_id="商务")
        self.assertIn("航天科技展厅", legacy_business_prompt)
        self.assertNotIn("商务展厅", legacy_business_prompt)

    def test_each_theme_uses_color_neutral_spatial_design_language(self):
        expectations = {
            "航天科技": "精密构造线",
            "党建": "庄重有序的叙事轴线",
        }
        forbidden = ("深蓝宇宙空间", "高级海报质感", "红色为主基调", "金色为点缀")

        for style_id, expected in expectations.items():
            with self.subTest(style_id=style_id):
                design_paragraph = self.execute(style_id=style_id).split("\n\n")[4]
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
