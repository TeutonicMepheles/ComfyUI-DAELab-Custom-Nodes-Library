import importlib.util
import pathlib
import unittest


NODE_PATH = (
    pathlib.Path(__file__).parents[1]
    / "nodes"
    / "gpt_image2_material_prompt"
    / "node.py"
)
SPEC = importlib.util.spec_from_file_location("gpt_image2_material_prompt_node", NODE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class GPTImage2MaterialPromptTests(unittest.TestCase):
    def setUp(self):
        self.materials = MODULE.load_materials()
        self.material_id, self.material = MODULE.resolve_material(
            self.materials, "深色拉丝古铜"
        )

    def test_catalog_resolves_stable_id_and_label(self):
        self.assertEqual(self.material_id, "dark_brushed_bronze")
        self.assertEqual(self.material["label"], "深色拉丝古铜")
        self.assertEqual(
            MODULE.resolve_material(self.materials, self.material_id)[0],
            self.material_id,
        )
        enamel_id, enamel = MODULE.resolve_material(
            self.materials, "浅灰细砂珐琅"
        )
        self.assertEqual(enamel_id, "light_speckled_enamel")
        self.assertIn("玻璃质珐琅釉面", enamel["semantic"])

    def test_catalog_contains_common_badge_materials(self):
        expected = {
            "baked_enamel": "烤漆",
            "transparent_lacquer": "透明漆",
            "satin_gold": "亚金",
            "satin_silver": "亚银",
            "glitter": "闪粉",
            "rhinestone": "水钻",
        }
        for material_id, label in expected.items():
            resolved_id, material = MODULE.resolve_material(self.materials, label)
            self.assertEqual(resolved_id, material_id)
            self.assertEqual(material["label"], label)
            self.assertTrue(material["semantic"])
            self.assertTrue(material["application"])
            self.assertTrue(material["avoid"])

    def test_semantics_describe_material_without_preview_geometry(self):
        semantics = MODULE.build_material_semantics(self.material, "#123ABC")
        self.assertIn("#123ABC", semantics)
        self.assertIn("sRGB 18, 58, 188", semantics)
        self.assertIn("古铜色金属基材", semantics)
        self.assertIn("各向异性纹理", semantics)
        self.assertIn("粗糙度", semantics)
        self.assertIn("不要生成", semantics)

    def test_prompt_is_structured_for_a_surgical_single_image_edit(self):
        prompt, semantics = MODULE.build_material_prompt(
            self.material,
            material_color="#2A7F62",
            base_prompt="仅修改 Image 1 中用户明确指定的目标区域",
            additional_details="纹理尺度与徽章尺寸协调",
        )
        self.assertIn("编辑目标：", prompt)
        self.assertIn("材质语义：", prompt)
        self.assertIn("颜色语义：", prompt)
        self.assertIn("#2A7F62", prompt)
        self.assertIn("保持不变：", prompt)
        self.assertIn("禁止：", prompt)
        self.assertIn("Image 1", prompt)
        self.assertNotIn("Image 2", prompt)
        self.assertIn("不要复制预览图中的球体轮廓", prompt)
        self.assertIn("目标区域以外的颜色", prompt)
        self.assertIn("纹理尺度与徽章尺寸协调", prompt)
        self.assertEqual(
            semantics,
            MODULE.build_material_semantics(self.material, "#2A7F62"),
        )

    def test_edit_target_is_optional_and_legacy_default_is_removed(self):
        for base_prompt in (
            None,
            "",
            "   ",
            MODULE.LEGACY_DEFAULT_BASE_PROMPT,
        ):
            prompt, _ = MODULE.build_material_prompt(
                self.material,
                base_prompt=base_prompt,
                use_color=False,
            )
            self.assertNotIn("编辑目标：", prompt)
            self.assertIn("参考图颜色锁定：", prompt)

        prompt, _ = MODULE.build_material_prompt(
            self.material,
            base_prompt="只处理用户指定的徽章区域",
            use_color=False,
        )
        self.assertIn("编辑目标：\n只处理用户指定的徽章区域。", prompt)

    def test_color_can_be_disabled_without_injecting_selected_color_semantics(self):
        prompt, semantics = MODULE.build_material_prompt(
            self.material,
            material_color="#2A7F62",
            use_color=False,
        )
        self.assertIn("材质语义：", prompt)
        self.assertIn(self.material["semantic_without_color"], prompt)
        self.assertIn(self.material["application_without_color"], prompt)
        self.assertIn(self.material["avoid_without_color"], prompt)
        self.assertIn("参考图颜色锁定：", prompt)
        self.assertIn(MODULE.REFERENCE_COLOR_LOCK, prompt)
        self.assertIn(MODULE.REFERENCE_COLOR_LOCK, semantics)
        for forbidden in (
            "颜色语义：",
            "#2A7F62",
            "sRGB",
            "目标基准色",
            "目标色作为",
            "深暖棕铜",
            "古铜色",
            "暖金铜色",
            "深棕近黑",
            "绿色铜锈",
        ):
            self.assertNotIn(forbidden, prompt)
            self.assertNotIn(forbidden, semantics)
        self.assertEqual(
            semantics,
            MODULE.build_material_semantics(
                self.material,
                "#2A7F62",
                use_color=False,
            ),
        )

    def test_color_enablement_normalizes_boolean_like_values(self):
        for enabled in (True, 1, "true", "on"):
            self.assertTrue(MODULE.is_material_color_enabled(enabled))
        for disabled in (False, 0, "false", "off", ""):
            self.assertFalse(MODULE.is_material_color_enabled(disabled))

    def test_every_material_has_a_color_independent_prompt_path(self):
        color_specific_terms = (
            "深暖棕铜",
            "古铜色",
            "暖金铜色",
            "深棕近黑",
            "绿色铜锈",
            "浅灰偏白",
            "深灰与黑色",
            "彩色漆面",
            "透明色层",
            "明确色相",
            "彩色滤光",
            "乳白",
            "无色玻璃",
            "金色金属",
            "温暖金属",
            "镜面黄金",
            "黄色塑料",
            "古铜氧化",
            "银色金属",
            "银灰色调",
            "冷调金属",
            "白色塑料",
            "彩虹氧化膜",
            "目标底色",
            "闪粉综合色调",
            "晶体色调",
        )
        for material in self.materials.values():
            for field in (
                "semantic_without_color",
                "application_without_color",
                "avoid_without_color",
            ):
                self.assertTrue(material.get(field), field)
            prompt, semantics = MODULE.build_material_prompt(
                material,
                material_color="#2A7F62",
                use_color=False,
            )
            self.assertIn(MODULE.REFERENCE_COLOR_LOCK, prompt)
            self.assertIn(MODULE.REFERENCE_COLOR_LOCK, semantics)
            for forbidden in (
                "颜色语义：",
                "#2A7F62",
                "sRGB",
                "目标色作为",
                *color_specific_terms,
            ):
                self.assertNotIn(forbidden, prompt)
                self.assertNotIn(forbidden, semantics)

    def test_missing_color_independent_fields_never_fall_back_to_colored_text(self):
        material = {
            "semantic": "仅供启用颜色时使用的红色金色材质语义",
            "application": "把目标色应用到整个区域",
            "avoid": "不要生成蓝色区域",
            "preview_color": "#FF0000",
        }
        prompt, semantics = MODULE.build_material_prompt(
            material,
            material_color="#00AAFF",
            use_color=False,
        )
        for forbidden in (
            "红色金色",
            "把目标色应用",
            "蓝色区域",
            "#00AAFF",
            "#FF0000",
        ):
            self.assertNotIn(forbidden, prompt)
            self.assertNotIn(forbidden, semantics)
        self.assertIn(MODULE.REFERENCE_COLOR_LOCK, prompt)
        self.assertIn(MODULE.REFERENCE_COLOR_LOCK, semantics)

    def test_auto_color_follows_material_default_and_custom_color_is_normalized(self):
        _, glitter = MODULE.resolve_material(self.materials, "闪粉")
        self.assertEqual(MODULE.resolve_material_color(glitter, "auto"), "#C94FA7")
        self.assertEqual(MODULE.resolve_material_color(glitter, "#0af"), "#C94FA7")
        self.assertEqual(MODULE.resolve_material_color(glitter, "#00aaff"), "#00AAFF")

    def test_preview_output_uses_comfyui_image_shape(self):
        preview = MODULE.load_material_preview(self.material)
        self.assertEqual(preview.ndim, 4)
        self.assertEqual(preview.shape[0], 1)
        self.assertEqual(preview.shape[-1], 3)
        self.assertGreater(preview.shape[1], 1)
        self.assertGreater(preview.shape[2], 1)
        self.assertGreaterEqual(float(preview.min()), 0.0)
        self.assertLessEqual(float(preview.max()), 1.0)

        _, enamel = MODULE.resolve_material(self.materials, "浅灰细砂珐琅")
        enamel_preview = MODULE.load_material_preview(enamel)
        self.assertEqual(tuple(enamel_preview.shape), (1, 1254, 1254, 3))

    def test_node_returns_prompt_semantics_and_preview(self):
        prompt, semantics, preview, selected_color = MODULE.GPTImage2MaterialPrompt().execute(
            "深色拉丝古铜",
            "#7A4B2F",
            MODULE.DEFAULT_BASE_PROMPT,
            "",
        )
        self.assertIn("深暖棕铜", prompt)
        self.assertIn("深暖棕铜", semantics)
        self.assertEqual(preview.shape[-1], 3)
        self.assertEqual(selected_color, "#7A4B2F")

    def test_node_disables_selected_color_output_and_preview_tint(self):
        prompt, semantics, preview, selected_color = MODULE.GPTImage2MaterialPrompt().execute(
            "深色拉丝古铜",
            "#7A4B2F",
            MODULE.DEFAULT_BASE_PROMPT,
            "",
            False,
        )
        self.assertNotIn("颜色语义：", prompt)
        self.assertNotIn("#7A4B2F", prompt)
        self.assertNotIn("#7A4B2F", semantics)
        self.assertIn(MODULE.REFERENCE_COLOR_LOCK, prompt)
        self.assertEqual(selected_color, "")
        self.assertEqual(preview.shape[-1], 3)

        raw_preview = MODULE.load_material_preview(self.material, use_color=False)
        self.assertTrue(raw_preview.equal(preview))

    def test_disabled_color_does_not_affect_change_hash(self):
        node = MODULE.GPTImage2MaterialPrompt
        first = node.IS_CHANGED(
            "深色拉丝古铜",
            "#7A4B2F",
            MODULE.DEFAULT_BASE_PROMPT,
            "",
            False,
        )
        second = node.IS_CHANGED(
            "深色拉丝古铜",
            "#00AAFF",
            MODULE.DEFAULT_BASE_PROMPT,
            "",
            False,
        )
        self.assertEqual(first, second)

    def test_input_schema_appends_use_color_for_legacy_widget_compatibility(self):
        required = MODULE.GPTImage2MaterialPrompt.INPUT_TYPES()["required"]
        self.assertEqual(
            list(required),
            [
                "material_id",
                "material_color",
                "base_prompt",
                "additional_details",
                "use_color",
            ],
        )
        self.assertTrue(required["use_color"][1]["default"])
        self.assertEqual(required["base_prompt"][1]["default"], "")

    def test_registration_is_stable(self):
        self.assertIs(
            MODULE.NODE_CLASS_MAPPINGS["GPTImage2MaterialPrompt"],
            MODULE.GPTImage2MaterialPrompt,
        )
        self.assertEqual(
            MODULE.NODE_DISPLAY_NAME_MAPPINGS["GPTImage2MaterialPrompt"],
            "GPT Image 2 材质提示词",
        )


if __name__ == "__main__":
    unittest.main()
