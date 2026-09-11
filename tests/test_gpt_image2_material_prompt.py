import importlib.util
import json
import pathlib
import unittest

import torch


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

    def test_catalog_resolves_stable_ids_and_contains_six_materials(self):
        self.assertEqual(len(self.materials), 6)
        self.assertEqual(self.material_id, "baked_enamel")
        expected = {
            "baked_enamel": "烤漆",
            "transparent_lacquer": "透明漆",
            "satin_gold": "亚金",
            "satin_silver": "亚银",
            "glitter": "闪粉",
            "rhinestone": "水钻",
        }
        self.assertEqual(set(self.materials), set(expected))
        self.assertEqual(set(MODULE.FALLBACK_MATERIALS), set(expected))
        for material_id, label in expected.items():
            resolved_id, material = MODULE.resolve_material(self.materials, label)
            self.assertEqual(resolved_id, material_id)
            self.assertEqual(material["label"], label)

    def test_catalog_has_only_achromatic_prompt_fields(self):
        forbidden_keys = {
            "preview_color",
            "default_color",
            "semantic_without_color",
            "application_without_color",
            "avoid_without_color",
        }
        base_keys = {"label", "thumbnail", "semantic", "application", "avoid"}
        for material_id, material in self.materials.items():
            self.assertFalse(forbidden_keys.intersection(material))
            expected_keys = set(base_keys)
            if material_id in {"satin_gold", "satin_silver"}:
                expected_keys.add("preview_keep_color")
                expected_keys.add("intrinsic_color_hex")
                expected_keys.add("surface_semantic")
                self.assertTrue(material["preview_keep_color"])
                self.assertRegex(material["intrinsic_color_hex"], r"^#[0-9a-fA-F]{6}$")
            self.assertEqual(set(material), expected_keys)

    def test_masked_surface_prompt_uses_each_catalog_material_without_old_color_lock(self):
        for material in self.materials.values():
            prompt = MODULE.build_masked_surface_prompt(material)
            self.assertIn(material.get('surface_semantic', material['semantic']), prompt)
            self.assertIn(material['application'], prompt)
            self.assertIn(material['avoid'], prompt)
            self.assertNotIn(MODULE.REFERENCE_COLOR_LOCK, prompt)
            self.assertNotIn('太阳能板', prompt)
            self.assertIn('允许高光', prompt)

    def test_prompt_is_structured_and_preserves_reference_colors(self):
        prompt, semantics = MODULE.build_material_prompt(
            self.material,
            base_prompt="仅修改 Image 1 中用户明确指定的目标区域",
            additional_details="纹理尺度与徽章尺寸协调",
        )
        for section in (
            "编辑目标：",
            "材质语义：",
            "参考图颜色锁定：",
            "材质应用：",
            "保持不变：",
            "融合要求：",
            "禁止：",
        ):
            self.assertIn(section, prompt)
        self.assertIn(MODULE.REFERENCE_COLOR_LOCK, prompt)
        self.assertIn(MODULE.REFERENCE_COLOR_LOCK, semantics)
        self.assertIn("REFERENCE COLOR LOCK", semantics)
        self.assertIn("SURFACE PROPERTIES", semantics)
        self.assertIn("APPLICATION", semantics)
        self.assertIn("AVOID", semantics)
        self.assertNotIn("；", semantics)
        self.assertIn("Do not darken, brighten", semantics)
        self.assertIn("mean or median base lightness", semantics)
        self.assertIn("the Image 1 color lock wins", semantics)
        self.assertIn("Image 1", prompt)
        self.assertNotIn("Image 2", prompt)
        self.assertIn("纹理尺度与徽章尺寸协调", prompt)

    def test_prompt_never_contains_color_selection_or_target_color_semantics(self):
        forbidden = (
            "颜色语义：",
            "目标基准色",
            "目标色作为",
            "sRGB",
            "preview_color",
            "material_color",
            "use_color",
            "#6B3F24",
            "#169C98",
        )
        for material in self.materials.values():
            prompt, semantics = MODULE.build_material_prompt(material)
            for text in forbidden:
                self.assertNotIn(text, prompt)
                self.assertNotIn(text, semantics)

    def test_edit_target_is_optional_and_legacy_default_is_removed(self):
        for base_prompt in (None, "", "   ", MODULE.LEGACY_DEFAULT_BASE_PROMPT):
            prompt, _ = MODULE.build_material_prompt(
                self.material,
                base_prompt=base_prompt,
            )
            self.assertNotIn("编辑目标：", prompt)
            self.assertIn("参考图颜色锁定：", prompt)

        prompt, _ = MODULE.build_material_prompt(
            self.material,
            base_prompt="只处理用户指定的徽章区域",
        )
        self.assertIn("编辑目标：\n只处理用户指定的徽章区域。", prompt)

    def test_preview_output_preserves_only_gold_and_silver_inherent_color(self):
        for material_id, material in self.materials.items():
            preview = MODULE.load_material_preview(material)
            self.assertEqual(preview.ndim, 4)
            self.assertEqual(preview.shape[0], 1)
            self.assertEqual(preview.shape[-1], 3)
            self.assertGreater(preview.shape[1], 1)
            self.assertGreater(preview.shape[2], 1)
            self.assertGreaterEqual(float(preview.min()), 0.0)
            self.assertLessEqual(float(preview.max()), 1.0)
            is_grayscale = (
                preview[..., 0].equal(preview[..., 1])
                and preview[..., 1].equal(preview[..., 2])
            )
            if material_id in {"satin_gold", "satin_silver"}:
                self.assertFalse(is_grayscale)
            else:
                self.assertTrue(is_grayscale)

    def test_missing_preview_uses_neutral_gray(self):
        preview = MODULE.load_material_preview({"thumbnail": "missing.png"})
        self.assertEqual(tuple(preview.shape), (1, 256, 256, 3))
        self.assertTrue(preview[..., 0].equal(preview[..., 1]))
        self.assertTrue(preview[..., 1].equal(preview[..., 2]))

    def test_node_schema_and_outputs_have_no_color_controls(self):
        required = MODULE.GPTImage2MaterialPrompt.INPUT_TYPES()["required"]
        self.assertEqual(
            list(required),
            ["material_id", "base_prompt", "additional_details"],
        )
        self.assertEqual(MODULE.GPTImage2MaterialPrompt.RETURN_TYPES, ("STRING", "STRING", "IMAGE"))
        self.assertEqual(
            MODULE.GPTImage2MaterialPrompt.RETURN_NAMES,
            ("prompt", "material_semantics", "preview_image"),
        )

        prompt, semantics, preview = MODULE.GPTImage2MaterialPrompt().execute(
            "烤漆",
            MODULE.DEFAULT_BASE_PROMPT,
            "",
        )
        self.assertIn("opaque heat-cured enamel", prompt)
        self.assertIn("opaque heat-cured enamel", semantics)
        self.assertEqual(preview.shape[-1], 3)

    def test_change_hash_uses_only_current_inputs_and_assets(self):
        first = MODULE.GPTImage2MaterialPrompt.IS_CHANGED(
            "烤漆", "", ""
        )
        second = MODULE.GPTImage2MaterialPrompt.IS_CHANGED(
            "烤漆", "", ""
        )
        changed = MODULE.GPTImage2MaterialPrompt.IS_CHANGED(
            "烤漆", "", "更细的纹理"
        )
        self.assertEqual(first, second)
        self.assertNotEqual(first, changed)

    def test_registration_is_stable(self):
        self.assertIs(
            MODULE.NODE_CLASS_MAPPINGS["GPTImage2MaterialPrompt"],
            MODULE.GPTImage2MaterialPrompt,
        )
        self.assertEqual(
            MODULE.NODE_DISPLAY_NAME_MAPPINGS["GPTImage2MaterialPrompt"],
            "GPT Image 2 材质提示词",
        )

    def test_material_region_config_defaults_to_clear_lacquer_and_drops_disabled_groups(self):
        config = MODULE.normalize_material_region_config(
            {
                "groups": [
                    {
                        "enabled": True,
                        "color": "#F00",
                        "threshold": 0,
                        "material_id": "闪粉",
                        "material_strength": 1.15,
                    },
                    {
                        "enabled": False,
                        "color": "#00ff00",
                        "material_id": "水钻",
                    },
                ]
            }
        )
        self.assertEqual(config["default_material_id"], "transparent_lacquer")
        self.assertEqual(len(config["groups"]), 1)
        self.assertEqual(config["groups"][0]["color"], "#ff0000")
        self.assertEqual(config["groups"][0]["material_id"], "glitter")
        self.assertEqual(config["groups"][0]["material_strength"], 1.15)

    def test_material_region_strength_is_clamped_and_serialized_canonically(self):
        config = MODULE.normalize_material_region_config({
            "groups": [
                {"id": "low", "material_strength": 0},
                {"id": "high", "material_strength": 99},
            ]
        })
        self.assertEqual([group["material_strength"] for group in config["groups"]], [0.25, 1.5])
        encoded = MODULE.encode_material_region_config(config)
        self.assertEqual(json.loads(encoded), config)

    def test_material_region_strength_digest_matches_frontend_canonical_json(self):
        config = {"groups": [{"id": "a", "color": "#112233"}]}
        self.assertEqual(
            MODULE.material_region_config_digest(config),
            "0e69a631c6e6a4938a3636938c01c8d08b31a9b9dfc8168610e0fefe1d96cd79",
        )

    def test_material_region_assignment_uses_source_colors_only_as_region_keys(self):
        images = torch.tensor(
            [[
                [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
                [[0.0, 0.0, 1.0], [1.0, 1.0, 1.0]],
            ]],
            dtype=torch.float32,
        )
        foreground = torch.tensor([[[1.0, 1.0], [1.0, 0.0]]], dtype=torch.float32)
        config = MODULE.normalize_material_region_config(
            {
                "groups": [
                    {"id": "red", "color": "#ff0000", "threshold": 0, "material_id": "glitter"},
                    {"id": "green", "color": "#00ff00", "threshold": 0, "material_id": "satin_gold"},
                ]
            }
        )
        assignment, diagnostic, default_mask, report = MODULE.make_material_region_assignment(
            images,
            config,
            foreground,
        )
        semantics = MODULE.build_material_region_semantics(assignment)

        self.assertEqual([group["matched_pixels"] for group in assignment["groups"]], [1, 1])
        self.assertEqual(assignment["configured_pixels"], 2)
        self.assertEqual(assignment["default_pixels"], 1)
        self.assertEqual(assignment["excluded_pixels"], 1)
        self.assertEqual(float(default_mask.sum()), 1.0)
        self.assertEqual(tuple(diagnostic.shape), (1, 2, 2, 3))
        self.assertIn("#ff0000", semantics)
        self.assertIn("Image 1 is the colored first-pass baked-enamel badge render", semantics)
        self.assertIn("source-region selectors for Image 2 only", semantics)
        self.assertIn("Edit Image 1 in place; do not reconstruct the badge from scratch", semantics)
        self.assertNotIn("neutral grayscale height-stage relief proof", semantics)
        self.assertNotIn("Do not retain Image 1's neutral gray", semantics)
        self.assertIn("Apply transparent lacquer", semantics)
        self.assertIn("Strictly preserve the region's intrinsic color", semantics)
        self.assertIn("Do not make the region globally or locally darker or lighter", semantics)
        self.assertIn("MATERIAL–GEOMETRY SEPARATION", semantics)
        self.assertIn("must not create, remove, raise, lower, bevel, or reshape the badge's macro relief", semantics)
        self.assertIn("Image 1 remains the sole authority for nominal height", semantics)
        self.assertIn("highest-level outer rim, contour strokes, text outlines, and metal separator-line", semantics)
        self.assertIn("no material may flatten, lower, swell, interrupt, or cover", semantics)
        self.assertIn("source-color region in Image 2", semantics)
        self.assertIn("may exist only within the assigned region", semantics)
        self.assertIn("crisp visual material boundary on one continuous nominal support surface", semantics)
        self.assertIn("Do not add a macro ridge, groove, gap, bevel, or height step", semantics)
        self.assertIn("existing baked-enamel continuity outside the selected regions", semantics)
        self.assertNotIn("烤漆", semantics)
        self.assertIn("Configured pixels: 2", report)

    def test_material_region_node_schema_connects_directly_to_badge_prompt_builder(self):
        schema = MODULE.DAELabBadgeMaterialRegionV1.INPUT_TYPES()
        self.assertEqual(list(schema["required"]), ["images"])
        self.assertEqual(
            list(schema["optional"]),
            ["foreground_mask", MODULE.MATERIAL_REGION_PROMPT_CONFIG_INPUT],
        )
        self.assertEqual(
            MODULE.DAELabBadgeMaterialRegionV1.RETURN_NAMES,
            (
                "material_semantics",
                "material_assignment",
                "diagnostic_preview",
                "default_material_mask",
                "validation_report",
                "applied_config",
                "config_revision",
                "config_digest",
                "material_region_set",
                "region_mask_batch",
            ),
        )
        self.assertIs(
            MODULE.NODE_CLASS_MAPPINGS["DAELabBadgeMaterialRegionV1"],
            MODULE.DAELabBadgeMaterialRegionV1,
        )
        self.assertEqual(
            MODULE.NODE_DISPLAY_NAME_MAPPINGS["DAELabBadgeMaterialRegionV1"],
            "Badge Material Region V1 (DAELab)",
        )

    def test_material_region_prompt_config_overrides_stale_workflow_metadata_and_cache(self):
        legacy = {
            "groups": [
                {"id": "old", "color": "#ff0000", "threshold": 0, "material_id": "glitter"},
            ]
        }
        current = {
            "groups": [
                {"id": "new", "color": "#00ff00", "threshold": 0, "material_id": "satin_gold"},
            ]
        }
        metadata = {
            "workflow": {
                "nodes": [
                    {
                        "id": 49,
                        "properties": {
                            MODULE.MATERIAL_REGION_V1_CONFIG_PROPERTY: json.dumps(legacy),
                        },
                    }
                ]
            }
        }
        current_json = json.dumps(current)
        resolved = MODULE._resolve_material_region_config(current_json, 49, metadata)
        fallback = MODULE._resolve_material_region_config("", 49, metadata)
        self.assertEqual(resolved["groups"][0]["id"], "new")
        self.assertEqual(fallback["groups"][0]["id"], "old")

        images = torch.tensor([[[[0.0, 1.0, 0.0]]]], dtype=torch.float32)
        old_hash = MODULE.DAELabBadgeMaterialRegionV1.IS_CHANGED(
            images,
            material_region_config=json.dumps(legacy),
            unique_id=49,
            extra_pnginfo=metadata,
        )
        new_hash = MODULE.DAELabBadgeMaterialRegionV1.IS_CHANGED(
            images,
            material_region_config=current_json,
            unique_id=49,
            extra_pnginfo=metadata,
        )
        self.assertNotEqual(old_hash, new_hash)

        result = MODULE.DAELabBadgeMaterialRegionV1().build(
            images,
            material_region_config=current_json,
            unique_id=49,
            extra_pnginfo=metadata,
        )
        semantics, assignment = result[:2]
        self.assertEqual(assignment["groups"][0]["id"], "new")
        self.assertEqual(assignment["groups"][0]["matched_pixels"], 1)
        self.assertIn("#00ff00", semantics)
        self.assertEqual(result[5], MODULE.encode_material_region_config(current))
        self.assertEqual(result[6], 0)
        self.assertEqual(result[7], MODULE.material_region_config_digest(current))
        self.assertEqual(tuple(result[9].shape), (1, 1, 1))

    def test_material_intrinsic_color_is_explicit_and_catalog_gated(self):
        config = MODULE.normalize_material_region_config(
            {
                "revision": 3,
                "groups": [
                    {
                        "id": "gold",
                        "color": "#00ff00",
                        "material_id": "satin_gold",
                        "color_policy": "material_intrinsic",
                        "reroll_revision": 2,
                    },
                    {
                        "id": "glitter",
                        "color": "#ff0000",
                        "material_id": "glitter",
                        "color_policy": "material_intrinsic",
                    },
                ],
            }
        )
        self.assertEqual(config["version"], 2)
        self.assertEqual(config["revision"], 3)
        self.assertEqual(config["groups"][0]["color_policy"], "material_intrinsic")
        self.assertEqual(config["groups"][1]["color_policy"], "preserve")
        assignment = {
            "default_material_id": "transparent_lacquer",
            "groups": [{**config["groups"][0], "matched_pixels": 1}],
        }
        semantics = MODULE.build_material_region_semantics(assignment)
        self.assertIn("#c8a86b", semantics)


if __name__ == "__main__":
    unittest.main()
